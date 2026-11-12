import { isSigningKeyError, SigningKeyFailure } from './signing-key-failure.js'

const MILLISECONDS_PER_SECOND = 1000

function buildSnapshot({ metadata, signingKeys, loadedAt, refreshDueAt }) {
  const keys = new Map(signingKeys)

  return Object.freeze({
    issuer: metadata.issuer,
    jwksUri: metadata.jwksUri,
    loadedAt,
    refreshDueAt,
    keyIds: Object.freeze([...keys.keys()]),
    getKey: (keyId) => keys.get(keyId) ?? null
  })
}

// Callers reject an already-aborted signal before this point, so only a later abort needs to be observed
function whenAborted(signal) {
  return new Promise((resolve) => {
    signal.addEventListener('abort', resolve, { once: true })
  })
}

/**
 * Shared, process-local signing-key provider. Resolves an exact `kid` to a verification key, keeping the
 * last valid OIDC metadata + JWKS snapshot and refreshing it only through one coalesced, throttled,
 * atomically-published refresh. It never validates tokens and never selects a fallback key.
 *
 * Refresh policy:
 * - the first lookup loads lazily (no startup dependency on Entra);
 * - a snapshot older than `refreshIntervalSeconds` is refreshed on the next lookup;
 * - an unknown `kid` triggers one refresh, then exactly one retry of the same lookup;
 * - attempts are separated by at least `minimumRefreshIntervalSeconds`; concurrent callers share one
 *   in-flight refresh;
 * - a failed or invalid refresh keeps the previous valid snapshot and never extends its due time.
 *
 * @param {Object} options
 * @param {{ fetchMetadata: Function }} options.metadataClient
 * @param {{ fetchSigningKeys: Function }} options.jwksClient
 * @param {number} options.refreshIntervalSeconds `entra.metadataRefreshIntervalSeconds`
 * @param {number} options.minimumRefreshIntervalSeconds `entra.minimumRefreshIntervalSeconds`
 * @param {() => number} [options.now] millisecond clock; injectable for deterministic tests
 * @param {{ warn: Function, debug: Function }} [options.logger]
 */
export function createSigningKeyProvider({
  metadataClient,
  jwksClient,
  refreshIntervalSeconds,
  minimumRefreshIntervalSeconds,
  now = Date.now,
  logger
}) {
  let snapshot = null
  let inFlightRefresh = null
  let lastAttemptAt = null
  let lastFailureReason = null

  async function runRefresh() {
    try {
      const metadata = await metadataClient.fetchMetadata()
      const signingKeys = await jwksClient.fetchSigningKeys(metadata.jwksUri)
      const loadedAt = now()

      snapshot = buildSnapshot({
        metadata,
        signingKeys,
        loadedAt,
        refreshDueAt:
          loadedAt + refreshIntervalSeconds * MILLISECONDS_PER_SECOND
      })
      lastFailureReason = null
      logger?.debug(
        { keyCount: snapshot.keyIds.length },
        'Entra signing keys refreshed'
      )

      return { ok: true }
    } catch (cause) {
      const reason = isSigningKeyError(cause)
        ? cause.reason
        : SigningKeyFailure.INTERNAL_ERROR
      lastFailureReason = reason
      logger?.warn({ reason }, 'Entra signing-key refresh failed')

      return { ok: false, reason }
    }
  }

  function startRefresh() {
    lastAttemptAt = now()
    const refresh = runRefresh()
    inFlightRefresh = refresh
    // runRefresh never rejects, so the lock is always released, including after parser failures
    refresh.finally(() => {
      if (inFlightRefresh === refresh) {
        inFlightRefresh = null
      }
    })
    return refresh
  }

  function isRefreshAttemptAllowed() {
    return (
      lastAttemptAt === null ||
      now() - lastAttemptAt >=
        minimumRefreshIntervalSeconds * MILLISECONDS_PER_SECOND
    )
  }

  async function refreshIfAllowed(signal) {
    let refresh = inFlightRefresh
    if (!refresh) {
      if (!isRefreshAttemptAllowed()) {
        return { status: 'throttled' }
      }
      refresh = startRefresh()
    }

    // A cancelled caller stops waiting; the shared refresh continues for any other caller.
    const settled = refresh.then((result) =>
      result.ok
        ? { status: 'refreshed' }
        : { status: 'failed', reason: result.reason }
    )
    return signal
      ? Promise.race([
          settled,
          whenAborted(signal).then(() => ({ status: 'cancelled' }))
        ])
      : settled
  }

  function failureFor(outcome) {
    switch (outcome.status) {
      case 'failed':
        return { reason: outcome.reason }
      case 'throttled':
        return {
          reason: SigningKeyFailure.REFRESH_THROTTLED,
          lastRefreshFailure: lastFailureReason
        }
      default:
        return { reason: SigningKeyFailure.KEY_NOT_FOUND }
    }
  }

  /**
   * @param {string} keyId the JWT header `kid`
   * @param {{ signal?: AbortSignal }} [options]
   * @returns {Promise<{ ok: true, keyId: string, key: unknown } | { ok: false, reason: string,
   *   refreshAttempted: boolean, lastRefreshFailure?: string | null }>}
   */
  async function getSigningKey(keyId, { signal } = {}) {
    if (typeof keyId !== 'string' || keyId.length === 0) {
      return {
        ok: false,
        reason: SigningKeyFailure.KEY_NOT_FOUND,
        refreshAttempted: false
      }
    }
    if (signal?.aborted) {
      return {
        ok: false,
        reason: SigningKeyFailure.REQUEST_CANCELLED,
        refreshAttempted: false
      }
    }

    const isFresh = snapshot !== null && now() < snapshot.refreshDueAt
    const cachedKey = snapshot?.getKey(keyId) ?? null
    if (cachedKey && isFresh) {
      return { ok: true, keyId, key: cachedKey }
    }

    // Absent, due for refresh, or unknown kid: at most one refresh for this resolution, one retry.
    const outcome = await refreshIfAllowed(signal)
    if (outcome.status === 'cancelled') {
      return {
        ok: false,
        reason: SigningKeyFailure.REQUEST_CANCELLED,
        refreshAttempted: true
      }
    }

    const key = snapshot?.getKey(keyId) ?? null
    if (key) {
      return { ok: true, keyId, key }
    }

    return {
      ok: false,
      refreshAttempted:
        outcome.status === 'refreshed' || outcome.status === 'failed',
      ...failureFor(outcome)
    }
  }

  return { getSigningKey }
}
