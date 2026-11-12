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
  // Map iteration order is insertion order, so the first key is always the least recently used
  const entries = new Map()
  const refreshes = new Map()

  const emit = (event, fields) => logger?.debug({ event, ...fields }, event)

  function evictIfNeeded() {
    if (entries.size <= maximumEntries) {
      return
    }

    emit('user-role-cache.capacity-reached')
    for (const [userId, entry] of entries) {
      if (now() >= entry.expiresAt) {
        entries.delete(userId)
        emit('user-role-cache.entry-evicted', { reason: 'expired' })
      }
    }
    while (entries.size > maximumEntries) {
      entries.delete(entries.keys().next().value)
      emit('user-role-cache.entry-evicted', { reason: 'least-recently-used' })
    }
  }

  function publish(userId, value) {
    const loadedAt = now()
    const existing = entries.get(userId)
    if (existing && existing.loadedAt > loadedAt) {
      return
    }

    // Re-inserting moves the user to the most recently used position
    entries.delete(userId)
    entries.set(
      userId,
      Object.freeze({
        value,
        loadedAt,
        expiresAt: loadedAt + ttlSeconds * MILLISECONDS_PER_SECOND
      })
    )
    emit(
      existing
        ? 'user-role-cache.entry-replaced'
        : 'user-role-cache.entry-inserted',
      {
        roleState: value.roleIds.length === 0 ? 'no-roles' : 'roles'
      }
    )
    evictIfNeeded()
  }

  async function refresh(user, correlationId) {
    emit('user-role-cache.refresh-started')
    try {
      const transport = await userProfileClient.getUserRoles(user, {
        correlationId
      })
      const result = validateUserRolesResult(transport, user)

      if (result.ok) {
        publish(user.userId, result.value)
        emit('user-role-cache.refresh-succeeded')
        return Object.freeze({
          ok: true,
          value: result.value,
          cacheState: UserRoleCacheState.REFRESHED
        })
      }

      logger?.warn(
        { event: 'user-role-cache.refresh-failed', source: result.source },
        'user-role-cache.refresh-failed'
      )
      return result
    } catch {
      logger?.warn(
        { event: 'user-role-cache.unexpected-error' },
        'user-role-cache.unexpected-error'
      )
      return cacheFailure(UserRoleCacheFailure.UNEXPECTED_CACHE_FAILURE)
    }
  }

  function joinOrStartRefresh(user, correlationId) {
    const existing = refreshes.get(user.userId)
    if (existing) {
      emit('user-role-cache.refresh-coalesced')
      return existing
    }

    const started = refresh(user, correlationId)
    refreshes.set(user.userId, started)
    // refresh never rejects, so the coordination state is always released
    started.finally(() => {
      if (refreshes.get(user.userId) === started) {
        refreshes.delete(user.userId)
      }
    })
    return started
  }

  /**
   * @param {Readonly<{ userId: string }>} user the trusted Step 04 authenticated-user context
   * @param {{ correlationId?: string, signal?: AbortSignal }} [options]
   * @returns {Promise<{ ok: true, value: object, cacheState: 'hit' | 'refreshed' }
   *   | { ok: false, source: 'dependency' | 'validation' | 'cache' }>}
   */
  async function getUserRoles(user, { correlationId, signal } = {}) {
    if (!isAuthenticatedUserContext(user)) {
      return cacheFailure(UserRoleCacheFailure.UNTRUSTED_USER_CONTEXT)
    }
    if (signal?.aborted) {
      return cancelledFailure()
    }

    const entry = entries.get(user.userId)
    if (entry && now() < entry.expiresAt) {
      entries.delete(user.userId)
      entries.set(user.userId, entry)
      emit('user-role-cache.hit')
      return Object.freeze({
        ok: true,
        value: entry.value,
        cacheState: UserRoleCacheState.HIT
      })
    }

    emit(entry ? 'user-role-cache.expired' : 'user-role-cache.miss')
    const pending = joinOrStartRefresh(user, correlationId)

    return signal
      ? Promise.race([pending, whenAborted(signal).then(cancelledFailure)])
      : pending
  }

  /** Releases all cached data; used at shutdown and in tests. */
  function clear() {
    entries.clear()
    refreshes.clear()
  }

  return { getUserRoles, clear }
}
