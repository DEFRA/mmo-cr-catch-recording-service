import { safeLog } from '#/common/helpers/logging/safe-log.js'
import { isSigningKeyError, SigningKeyFailure } from './signing-key-failure.js'

const MILLISECONDS_PER_SECOND = 1000
const REFRESH_EVENT = 'oidc.refresh'
const LOOKUP_EVENT = 'oidc.lookup'
const WARN = 'warn'

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

function lookupFailure(reason, refreshAttempted) {
  return { ok: false, reason, refreshAttempted }
}

function failureFor(outcome, lastFailureReason) {
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

function toRefreshOutcome(result) {
  return result.ok
    ? { status: 'refreshed' }
    : { status: 'failed', reason: result.reason }
}

class SigningKeyProvider {
  #metadataClient
  #jwksClient
  #refreshIntervalMs
  #minimumRefreshIntervalMs
  #now
  #logger
  #snapshot = null
  #inFlightRefresh = null
  #lastAttemptAt = null
  #lastFailureReason = null

  constructor({
    metadataClient,
    jwksClient,
    refreshIntervalSeconds,
    minimumRefreshIntervalSeconds,
    now,
    logger
  }) {
    this.#metadataClient = metadataClient
    this.#jwksClient = jwksClient
    this.#refreshIntervalMs = refreshIntervalSeconds * MILLISECONDS_PER_SECOND
    this.#minimumRefreshIntervalMs =
      minimumRefreshIntervalSeconds * MILLISECONDS_PER_SECOND
    this.#now = now
    this.#logger = logger
  }

  async #runRefresh() {
    const startedAt = this.#now()
    try {
      const metadata = await this.#metadataClient.fetchMetadata()
      const signingKeys = await this.#jwksClient.fetchSigningKeys(
        metadata.jwksUri
      )
      const loadedAt = this.#now()

      this.#snapshot = buildSnapshot({
        metadata,
        signingKeys,
        loadedAt,
        refreshDueAt: loadedAt + this.#refreshIntervalMs
      })
      this.#lastFailureReason = null
      safeLog(
        this.#logger,
        'info',
        {
          event: REFRESH_EVENT,
          outcome: 'success',
          keyCount: this.#snapshot.keyIds.length,
          durationMs: loadedAt - startedAt
        },
        REFRESH_EVENT
      )

      return { ok: true }
    } catch (cause) {
      return this.#recordRefreshFailure(cause, startedAt)
    }
  }

  #recordRefreshFailure(cause, startedAt) {
    const reason = isSigningKeyError(cause)
      ? cause.reason
      : SigningKeyFailure.INTERNAL_ERROR
    this.#lastFailureReason = reason
    safeLog(
      this.#logger,
      WARN,
      {
        event: REFRESH_EVENT,
        outcome: 'failure',
        reason,
        durationMs: this.#now() - startedAt
      },
      REFRESH_EVENT
    )

    return { ok: false, reason }
  }

  #startRefresh() {
    this.#lastAttemptAt = this.#now()
    const refresh = this.#runRefresh()
    this.#inFlightRefresh = refresh
    // runRefresh never rejects, so the lock is always released, including after parser failures
    refresh
      .finally(() => {
        if (this.#inFlightRefresh === refresh) {
          this.#inFlightRefresh = null
        }
      })
      .catch(() => {})
    return refresh
  }

  #isRefreshAttemptAllowed() {
    return (
      this.#lastAttemptAt === null ||
      this.#now() - this.#lastAttemptAt >= this.#minimumRefreshIntervalMs
    )
  }

  async #refreshIfAllowed(signal) {
    let refresh = this.#inFlightRefresh
    if (!refresh) {
      if (!this.#isRefreshAttemptAllowed()) {
        return { status: 'throttled' }
      }
      refresh = this.#startRefresh()
    }

    // A cancelled caller stops waiting; the shared refresh continues for any other caller.
    const settled = refresh.then(toRefreshOutcome)
    return signal
      ? Promise.race([
          settled,
          whenAborted(signal).then(() => ({ status: 'cancelled' }))
        ])
      : settled
  }

  #logLookup(outcome, reason) {
    safeLog(
      this.#logger,
      WARN,
      { event: LOOKUP_EVENT, outcome, reason },
      LOOKUP_EVENT
    )
  }

  #findFreshKey(keyId) {
    const isFresh =
      this.#snapshot !== null && this.#now() < this.#snapshot.refreshDueAt
    const key = this.#snapshot?.getKey(keyId) ?? null
    return isFresh ? key : null
  }

  /**
   * @param {string} keyId the JWT header `kid`
   * @param {{ signal?: AbortSignal }} [options]
   * @returns {Promise<{ ok: true, keyId: string, key: unknown } | { ok: false, reason: string,
   *   refreshAttempted: boolean, lastRefreshFailure?: string | null }>}
   */
  async getSigningKey(keyId, { signal } = {}) {
    if (typeof keyId !== 'string' || keyId.length === 0) {
      return lookupFailure(SigningKeyFailure.KEY_NOT_FOUND, false)
    }
    if (signal?.aborted) {
      return lookupFailure(SigningKeyFailure.REQUEST_CANCELLED, false)
    }

    const cachedKey = this.#findFreshKey(keyId)
    if (cachedKey) {
      return { ok: true, keyId, key: cachedKey }
    }

    // Absent, due for refresh, or unknown kid: at most one refresh for this resolution, one retry.
    const outcome = await this.#refreshIfAllowed(signal)
    if (outcome.status === 'cancelled') {
      return lookupFailure(SigningKeyFailure.REQUEST_CANCELLED, true)
    }

    return this.#resolveAfterRefresh(keyId, outcome)
  }

  #resolveAfterRefresh(keyId, outcome) {
    if (outcome.status === 'throttled') {
      this.#logLookup('throttled', 'refresh-throttled')
    }

    const key = this.#snapshot?.getKey(keyId) ?? null
    if (key) {
      return { ok: true, keyId, key }
    }

    if (outcome.status === 'refreshed') {
      // Counted without the raw key identifier
      this.#logLookup('unknown-kid', 'key-not-found')
    }

    return {
      ok: false,
      refreshAttempted:
        outcome.status === 'refreshed' || outcome.status === 'failed',
      ...failureFor(outcome, this.#lastFailureReason)
    }
  }
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
  const provider = new SigningKeyProvider({
    metadataClient,
    jwksClient,
    refreshIntervalSeconds,
    minimumRefreshIntervalSeconds,
    now,
    logger
  })

  return {
    getSigningKey: (keyId, options) => provider.getSigningKey(keyId, options)
  }
}
