import { safeLog } from '#/common/helpers/logging/safe-log.js'
import { validateRoleDefinitionsResult } from './authorization-response-validator.js'
import { UserProfileOutcome } from './user-profile-client.js'

const MILLISECONDS_PER_SECOND = 1000

export const RoleDefinitionsCacheFailure = Object.freeze({
  UNEXPECTED_CACHE_FAILURE: 'UNEXPECTED_CACHE_FAILURE'
})

/** How the usable snapshot was obtained. */
export const RoleDefinitionsCacheState = Object.freeze({
  HIT: 'hit',
  LOADED: 'loaded',
  REFRESHED: 'refreshed',
  STALE_USED: 'stale-used'
})

/** The state of the held snapshot at a point in time. */
export const SnapshotState = Object.freeze({
  ABSENT: 'absent',
  FRESH: 'fresh',
  STALE: 'stale',
  OVER_STALE: 'over-stale'
})

const cancelledFailure = () =>
  Object.freeze({
    ok: false,
    source: 'dependency',
    outcome: UserProfileOutcome.CANCELLED,
    status: null
  })

const CALLER_CANCELLED = Symbol('caller-cancelled')

function whenAborted(signal) {
  return new Promise((resolve) => {
    signal.addEventListener('abort', () => resolve(CALLER_CANCELLED), {
      once: true
    })
  })
}

/** Only these safe facts about a failed refresh are ever exposed or logged. */
function describeFailure(failure) {
  return failure.source === 'dependency'
    ? { source: failure.source, outcome: failure.outcome }
    : { source: failure.source, reason: failure.reason }
}

class RoleDefinitionsCache {
  #userProfileClient
  #serviceId
  #ttlMs
  #maximumStaleMs
  #now
  #logger
  #snapshot = null
  #inFlightRefresh = null

  constructor({
    userProfileClient,
    serviceId,
    ttlSeconds,
    maximumStaleSeconds,
    now,
    logger
  }) {
    this.#userProfileClient = userProfileClient
    this.#serviceId = serviceId
    this.#ttlMs = ttlSeconds * MILLISECONDS_PER_SECOND
    this.#maximumStaleMs = maximumStaleSeconds * MILLISECONDS_PER_SECOND
    this.#now = now
    this.#logger = logger
  }

  #emit(event, fields) {
    safeLog(this.#logger, 'debug', { event, ...fields }, event)
  }

  #warn(event, fields) {
    safeLog(this.#logger, 'warn', { event, ...fields }, event)
  }

  #stateOf(held) {
    if (!held) {
      return SnapshotState.ABSENT
    }
    const time = this.#now()
    if (time < held.freshUntil) {
      return SnapshotState.FRESH
    }
    return time < held.maximumStaleUntil
      ? SnapshotState.STALE
      : SnapshotState.OVER_STALE
  }

  #publish(definitions) {
    const loadedAt = this.#now()
    if (this.#snapshot && this.#snapshot.loadedAt > loadedAt) {
      return this.#snapshot
    }

    const freshUntil = loadedAt + this.#ttlMs
    this.#snapshot = Object.freeze({
      ...definitions,
      loadedAt,
      freshUntil,
      maximumStaleUntil: freshUntil + this.#maximumStaleMs
    })
    return this.#snapshot
  }

  async #refresh(correlationId) {
    this.#emit('role-definitions-cache.refresh-started', { correlationId })
    const startedAt = this.#now()
    try {
      const transport = await this.#userProfileClient.getRoleDefinitions({
        correlationId
      })
      const result = validateRoleDefinitionsResult(transport, this.#serviceId)

      if (result.ok) {
        const published = this.#publish(result.value)
        this.#emit('role-definitions-cache.refresh-succeeded', {
          definitionsVersion: published.definitionsVersion,
          correlationId,
          durationMs: this.#now() - startedAt
        })
        return Object.freeze({ ok: true, snapshot: published })
      }

      this.#warn('role-definitions-cache.refresh-failed', {
        ...describeFailure(result),
        correlationId,
        durationMs: this.#now() - startedAt
      })
      return result
    } catch {
      this.#warn('role-definitions-cache.unexpected-error', { correlationId })
      return Object.freeze({
        ok: false,
        source: 'cache',
        reason: RoleDefinitionsCacheFailure.UNEXPECTED_CACHE_FAILURE
      })
    }
  }

  #joinOrStartRefresh(correlationId) {
    if (this.#inFlightRefresh) {
      this.#emit('role-definitions-cache.refresh-coalesced')
      return this.#inFlightRefresh
    }

    const started = this.#refresh(correlationId)
    this.#inFlightRefresh = started
    // refresh never rejects, so the coordination state is always released
    started
      .finally(() => {
        if (this.#inFlightRefresh === started) {
          this.#inFlightRefresh = null
        }
      })
      .catch(() => {})
    return started
  }

  #resultAfterRefresh(refreshResult, previous) {
    if (refreshResult.ok) {
      return Object.freeze({
        ok: true,
        snapshot: refreshResult.snapshot,
        freshness: SnapshotState.FRESH,
        cacheState:
          previous === null
            ? RoleDefinitionsCacheState.LOADED
            : RoleDefinitionsCacheState.REFRESHED
      })
    }

    // Re-evaluated now: waiting for the refresh must not let a snapshot outlive its maximum-stale boundary
    const previousState = this.#stateOf(previous)
    if (previousState === SnapshotState.STALE) {
      this.#emit('role-definitions-cache.stale-used', {
        staleDefinitionsUsed: true
      })
      return Object.freeze({
        ok: true,
        snapshot: previous,
        freshness: SnapshotState.STALE,
        cacheState: RoleDefinitionsCacheState.STALE_USED,
        refreshFailure: describeFailure(refreshResult)
      })
    }

    return Object.freeze({ ...refreshResult, snapshotState: previousState })
  }

  /**
   * @param {{ correlationId?: string, signal?: AbortSignal }} [options]
   * @returns {Promise<{ ok: true, snapshot: object, freshness: 'fresh' | 'stale', cacheState: string,
   *   refreshFailure?: object } | { ok: false, source: string, snapshotState?: string }>}
   */
  async getRoleDefinitions({ correlationId, signal } = {}) {
    if (signal?.aborted) {
      return cancelledFailure()
    }

    const held = this.#snapshot
    const heldState = this.#stateOf(held)
    if (heldState === SnapshotState.FRESH) {
      this.#emit('role-definitions-cache.hit')
      return Object.freeze({
        ok: true,
        snapshot: held,
        freshness: SnapshotState.FRESH,
        cacheState: RoleDefinitionsCacheState.HIT
      })
    }

    this.#emit(
      heldState === SnapshotState.ABSENT
        ? 'role-definitions-cache.load'
        : `role-definitions-cache.${heldState}`
    )
    const pending = this.#joinOrStartRefresh(correlationId)
    const refreshResult = signal
      ? await Promise.race([pending, whenAborted(signal)])
      : await pending

    return refreshResult === CALLER_CANCELLED
      ? cancelledFailure()
      : this.#resultAfterRefresh(refreshResult, held)
  }

  /** Safe diagnostics for later health reporting; exposes no definitions. */
  getStatus() {
    return Object.freeze({
      state: this.#stateOf(this.#snapshot),
      definitionsVersion: this.#snapshot?.definitionsVersion ?? null
    })
  }

  /** Releases the held snapshot; used at shutdown and in tests. */
  clear() {
    this.#snapshot = null
    this.#inFlightRefresh = null
  }
}

/**
 * Process-local cache holding one immutable, validated role-to-capability snapshot for the configured
 * Catch Recording service.
 *
 * Timing is measured from the successful load on a monotonic clock:
 *   freshUntil        = loadedAt + TTL
 *   maximumStaleUntil = freshUntil + maximum stale   (the stale window is *additional* to the TTL)
 * and a snapshot is
 *   fresh      while now < freshUntil
 *   stale      while freshUntil <= now < maximumStaleUntil
 *   over-stale from now >= maximumStaleUntil (never usable; a successful refresh is required).
 *
 * - Fresh snapshots are returned without a request and reading never extends a lifetime.
 * - A stale snapshot triggers a refresh; if that fails, the previous snapshot is returned with an
 *   explicit `stale-used` outcome - never past its maximum-stale boundary. A failed refresh changes no
 *   timing.
 * - With no snapshot (or an over-stale one) and a failed refresh the result is a failure: nothing is
 *   defaulted, emptied or permissive, and Step 06 rejects empty or unusable definitions.
 * - The initial load uses the same refresh operation as every later load: one single-flight refresh is
 *   shared by all callers (network I/O is never done under a lock), published atomically only after Step
 *   06 validation, and never overwritten by an older result.
 *
 * @param {Object} options
 * @param {{ getRoleDefinitions: Function }} options.userProfileClient Step 05 client
 * @param {string} options.serviceId `authorization.serviceId`
 * @param {number} options.ttlSeconds `authorization.roleDefinitionsCacheTtlSeconds`
 * @param {number} options.maximumStaleSeconds `authorization.roleDefinitionsCacheMaximumStaleSeconds`
 * @param {() => number} [options.now] monotonic millisecond clock; injectable for deterministic tests
 * @param {{ debug: Function, warn: Function }} [options.logger]
 */
export function createRoleDefinitionsCache({
  userProfileClient,
  serviceId,
  ttlSeconds,
  maximumStaleSeconds,
  now = () => performance.now(),
  logger
}) {
  const cache = new RoleDefinitionsCache({
    userProfileClient,
    serviceId,
    ttlSeconds,
    maximumStaleSeconds,
    now,
    logger
  })

  return {
    getRoleDefinitions: (options) => cache.getRoleDefinitions(options),
    getStatus: () => cache.getStatus(),
    clear: () => cache.clear()
  }
}
