import { safeLog } from '#/common/helpers/logging/safe-log.js'
import { isAuthenticatedUserContext } from '#/authentication/entra/authenticated-user-context.js'
import { validateUserRolesResult } from './authorization-response-validator.js'
import { UserProfileOutcome } from './user-profile-client.js'

const MILLISECONDS_PER_SECOND = 1000

export const UserRoleCacheFailure = Object.freeze({
  UNTRUSTED_USER_CONTEXT: 'UNTRUSTED_USER_CONTEXT',
  UNEXPECTED_CACHE_FAILURE: 'UNEXPECTED_CACHE_FAILURE'
})

export const UserRoleCacheState = Object.freeze({
  HIT: 'hit',
  REFRESHED: 'refreshed'
})

const cacheFailure = (reason) =>
  Object.freeze({ ok: false, source: 'cache', reason })

const cancelledFailure = () =>
  Object.freeze({
    ok: false,
    source: 'dependency',
    outcome: UserProfileOutcome.CANCELLED,
    status: null
  })

function whenAborted(signal) {
  return new Promise((resolve) => {
    signal.addEventListener('abort', resolve, { once: true })
  })
}

class UserRoleCache {
  #userProfileClient
  #ttlMs
  #maximumEntries
  #now
  #logger
  // Map iteration order is insertion order, so the first key is always the least recently used
  #entries = new Map()
  #refreshes = new Map()

  constructor({ userProfileClient, ttlSeconds, maximumEntries, now, logger }) {
    this.#userProfileClient = userProfileClient
    this.#ttlMs = ttlSeconds * MILLISECONDS_PER_SECOND
    this.#maximumEntries = maximumEntries
    this.#now = now
    this.#logger = logger
  }

  #emit(event, fields) {
    safeLog(this.#logger, 'debug', { event, ...fields }, event)
  }

  #warn(event, fields) {
    safeLog(this.#logger, 'warn', { event, ...fields }, event)
  }

  #evictIfNeeded() {
    if (this.#entries.size <= this.#maximumEntries) {
      return
    }

    this.#emit('user-role-cache.capacity-reached')
    for (const [userId, entry] of this.#entries) {
      if (this.#now() >= entry.expiresAt) {
        this.#entries.delete(userId)
        this.#emit('user-role-cache.entry-evicted', { reason: 'expired' })
      }
    }
    while (this.#entries.size > this.#maximumEntries) {
      this.#entries.delete(this.#entries.keys().next().value)
      this.#emit('user-role-cache.entry-evicted', {
        reason: 'least-recently-used'
      })
    }
  }

  #publish(userId, value) {
    const loadedAt = this.#now()
    const existing = this.#entries.get(userId)
    if (existing && existing.loadedAt > loadedAt) {
      return
    }

    // Re-inserting moves the user to the most recently used position
    this.#entries.delete(userId)
    this.#entries.set(
      userId,
      Object.freeze({ value, loadedAt, expiresAt: loadedAt + this.#ttlMs })
    )
    this.#emit(
      existing
        ? 'user-role-cache.entry-replaced'
        : 'user-role-cache.entry-inserted',
      { roleState: value.roleIds.length === 0 ? 'no-roles' : 'roles' }
    )
    this.#evictIfNeeded()
  }

  async #refresh(user, correlationId) {
    this.#emit('user-role-cache.refresh-started', { correlationId })
    const startedAt = this.#now()
    try {
      const transport = await this.#userProfileClient.getUserRoles(user, {
        correlationId
      })
      const result = validateUserRolesResult(transport, user)

      if (result.ok) {
        this.#publish(user.userId, result.value)
        this.#emit('user-role-cache.refresh-succeeded', {
          correlationId,
          durationMs: this.#now() - startedAt
        })
        return Object.freeze({
          ok: true,
          value: result.value,
          cacheState: UserRoleCacheState.REFRESHED
        })
      }

      this.#warn('user-role-cache.refresh-failed', {
        source: result.source,
        outcome: result.outcome,
        reason: result.reason,
        correlationId,
        durationMs: this.#now() - startedAt
      })
      return result
    } catch {
      this.#warn('user-role-cache.unexpected-error', { correlationId })
      return cacheFailure(UserRoleCacheFailure.UNEXPECTED_CACHE_FAILURE)
    }
  }

  #joinOrStartRefresh(user, correlationId) {
    const existing = this.#refreshes.get(user.userId)
    if (existing) {
      this.#emit('user-role-cache.refresh-coalesced')
      return existing
    }

    const started = this.#refresh(user, correlationId)
    this.#refreshes.set(user.userId, started)
    // refresh never rejects, so the coordination state is always released
    started
      .finally(() => {
        if (this.#refreshes.get(user.userId) === started) {
          this.#refreshes.delete(user.userId)
        }
      })
      .catch(() => {})
    return started
  }

  /**
   * @param {Readonly<{ userId: string }>} user the trusted Step 04 authenticated-user context
   * @param {{ correlationId?: string, signal?: AbortSignal }} [options]
   * @returns {Promise<{ ok: true, value: object, cacheState: 'hit' | 'refreshed' }
   *   | { ok: false, source: 'dependency' | 'validation' | 'cache' }>}
   */
  async getUserRoles(user, { correlationId, signal } = {}) {
    if (!isAuthenticatedUserContext(user)) {
      return cacheFailure(UserRoleCacheFailure.UNTRUSTED_USER_CONTEXT)
    }
    if (signal?.aborted) {
      return cancelledFailure()
    }

    const entry = this.#entries.get(user.userId)
    if (entry && this.#now() < entry.expiresAt) {
      this.#entries.delete(user.userId)
      this.#entries.set(user.userId, entry)
      this.#emit('user-role-cache.hit')
      return Object.freeze({
        ok: true,
        value: entry.value,
        cacheState: UserRoleCacheState.HIT
      })
    }

    this.#emit(entry ? 'user-role-cache.expired' : 'user-role-cache.miss')
    const pending = this.#joinOrStartRefresh(user, correlationId)

    return signal
      ? Promise.race([pending, whenAborted(signal).then(cancelledFailure)])
      : pending
  }

  /** Releases all cached data; used at shutdown and in tests. */
  clear() {
    this.#entries.clear()
    this.#refreshes.clear()
  }
}

/**
 * Process-local, bounded cache of validated user-role assignments, keyed only by the trusted stable user
 * identifier.
 *
 * - Only Step 06 validated, immutable models are stored; failures (dependency or validation) are never
 *   cached and never become an empty role set.
 * - An entry is fresh while `now < expiresAt` (`expiresAt` = successful refresh time + TTL) and expired
 *   from `now >= expiresAt`. An expired entry is never returned, not even when a refresh fails, and a
 *   failed refresh never extends it: there is no maximum-stale period for user roles.
 * - Valid no-role responses (the contract's representation of an unknown user) are cached for the
 *   normal TTL like any other.
 * - Concurrent lookups for one user share one refresh; different users refresh independently and no lock
 *   is held while waiting for I/O. A caller that cancels stops waiting without cancelling the shared
 *   refresh.
 * - Capacity is bounded; when full, expired entries are removed first and then the least recently used
 *   entry (a hit counts as use) is evicted.
 *
 * @param {Object} options
 * @param {{ getUserRoles: Function }} options.userProfileClient Step 05 client
 * @param {number} options.ttlSeconds `authorization.userRoleCacheTtlSeconds`
 * @param {number} options.maximumEntries `authorization.userRoleCacheMaximumEntries`
 * @param {() => number} [options.now] monotonic millisecond clock; injectable for deterministic tests
 * @param {{ debug: Function, warn: Function }} [options.logger]
 */
export function createUserRoleCache({
  userProfileClient,
  ttlSeconds,
  maximumEntries,
  now = () => performance.now(),
  logger
}) {
  const cache = new UserRoleCache({
    userProfileClient,
    ttlSeconds,
    maximumEntries,
    now,
    logger
  })

  return {
    getUserRoles: (user, options) => cache.getUserRoles(user, options),
    clear: () => cache.clear()
  }
}
