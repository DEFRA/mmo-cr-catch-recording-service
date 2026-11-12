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
  let snapshot = null
  let inFlightRefresh = null

  const emit = (event, fields) => logger?.debug({ event, ...fields }, event)

  function stateOf(held) {
    if (!held) {
      return SnapshotState.ABSENT
    }
    const time = now()
    if (time < held.freshUntil) {
      return SnapshotState.FRESH
    }
    return time < held.maximumStaleUntil
      ? SnapshotState.STALE
      : SnapshotState.OVER_STALE
  }

  function publish(definitions) {
    const loadedAt = now()
    if (snapshot && snapshot.loadedAt > loadedAt) {
      return snapshot
    }

    const freshUntil = loadedAt + ttlSeconds * MILLISECONDS_PER_SECOND
    snapshot = Object.freeze({
      ...definitions,
      loadedAt,
      freshUntil,
      maximumStaleUntil:
        freshUntil + maximumStaleSeconds * MILLISECONDS_PER_SECOND
    })
    return snapshot
  }

  async function refresh(correlationId) {
    emit('role-definitions-cache.refresh-started')
    try {
      const transport = await userProfileClient.getRoleDefinitions({
        correlationId
      })
      const result = validateRoleDefinitionsResult(transport, serviceId)

      if (result.ok) {
        const published = publish(result.value)
        emit('role-definitions-cache.refresh-succeeded', {
          definitionsVersion: published.definitionsVersion
        })
        return Object.freeze({ ok: true, snapshot: published })
      }

      logger?.warn(
        {
          event: 'role-definitions-cache.refresh-failed',
          ...describeFailure(result)
        },
        'role-definitions-cache.refresh-failed'
      )
      return result
    } catch {
      logger?.warn(
        { event: 'role-definitions-cache.unexpected-error' },
        'role-definitions-cache.unexpected-error'
      )
      return Object.freeze({
        ok: false,
        source: 'cache',
        reason: RoleDefinitionsCacheFailure.UNEXPECTED_CACHE_FAILURE
      })
    }
  }

  function joinOrStartRefresh(correlationId) {
    if (inFlightRefresh) {
      emit('role-definitions-cache.refresh-coalesced')
      return inFlightRefresh
    }

    const started = refresh(correlationId)
    inFlightRefresh = started
    // refresh never rejects, so the coordination state is always released
    started.finally(() => {
      if (inFlightRefresh === started) {
        inFlightRefresh = null
      }
    })
    return started
  }

  function resultAfterRefresh(refreshResult, previous) {
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
    const previousState = stateOf(previous)
    if (previousState === SnapshotState.STALE) {
      emit('role-definitions-cache.stale-used')
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
  async function getRoleDefinitions({ correlationId, signal } = {}) {
    if (signal?.aborted) {
      return cancelledFailure()
    }

    const held = snapshot
    const heldState = stateOf(held)
    if (heldState === SnapshotState.FRESH) {
      emit('role-definitions-cache.hit')
      return Object.freeze({
        ok: true,
        snapshot: held,
        freshness: SnapshotState.FRESH,
        cacheState: RoleDefinitionsCacheState.HIT
      })
    }

    emit(
      heldState === SnapshotState.ABSENT
        ? 'role-definitions-cache.load'
        : `role-definitions-cache.${heldState}`
    )
    const pending = joinOrStartRefresh(correlationId)
    const refreshResult = signal
      ? await Promise.race([pending, whenAborted(signal)])
      : await pending

    return refreshResult === CALLER_CANCELLED
      ? cancelledFailure()
      : resultAfterRefresh(refreshResult, held)
  }

  /** Safe diagnostics for later health reporting; exposes no definitions. */
  function getStatus() {
    return Object.freeze({
      state: stateOf(snapshot),
      definitionsVersion: snapshot?.definitionsVersion ?? null
    })
  }

  /** Releases the held snapshot; used at shutdown and in tests. */
  function clear() {
    snapshot = null
    inFlightRefresh = null
  }

  return { getRoleDefinitions, getStatus, clear }
}
