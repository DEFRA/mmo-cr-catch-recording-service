import { AccessTokenFailure } from '#/authentication/entra/access-token-validator.js'

const SAFE_TEXT = /^[A-Za-z0-9._:-]{1,128}$/

// Bounded, stable field allow-list. Anything else (tokens, claims, identifiers, roles, URLs, errors,
// bodies, arbitrary objects) is dropped before it can reach a log line or a metric dimension.
const LOG_FIELDS = Object.freeze([
  'event',
  'component',
  'operation',
  'outcome',
  'reason',
  'category',
  'statusCode',
  'source',
  'status',
  'attempt',
  'cacheState',
  'userRoleCacheState',
  'roleDefinitionsCacheState',
  'roleState',
  'result',
  'staleDefinitionsUsed',
  'definitionsVersion',
  'capability',
  'unknownRoleCount',
  'keyCount',
  'durationMs',
  'correlationId'
])

const CACHE_RESULTS = Object.freeze([
  'hit',
  'miss',
  'expired',
  'stale',
  'over-stale',
  'load',
  'refresh-started',
  'refresh-succeeded',
  'refresh-failed',
  'refresh-coalesced',
  'entry-inserted',
  'entry-replaced',
  'entry-evicted',
  'capacity-reached',
  'stale-used',
  'unexpected-error'
])

/** Event name -> counter, optional latency metric (milliseconds) and the bounded metric dimensions. */
const EVENTS = Object.freeze({
  'auth.token-validation': {
    counter: 'authTokenValidations',
    millis: 'authTokenValidationMs',
    dimensions: ['outcome', 'reason']
  },
  'oidc.refresh': {
    counter: 'authSigningKeyRefreshes',
    millis: 'authSigningKeyRefreshMs',
    dimensions: ['outcome', 'reason']
  },
  'oidc.lookup': {
    counter: 'authSigningKeyLookups',
    dimensions: ['outcome', 'reason']
  },
  'user-profile.request': {
    counter: 'authUserProfileRequests',
    millis: 'authUserProfileRequestMs',
    dimensions: ['operation', 'outcome']
  },
  'user-profile.retry': {
    counter: 'authUserProfileRetries',
    dimensions: ['operation']
  },
  'authorization.decision': {
    counter: 'authDecisions',
    millis: 'authDecisionMs',
    dimensions: ['outcome', 'reason']
  },
  'authorization.missing-mapping': {
    counter: 'authMissingMappings',
    dimensions: []
  },
  'access-response': {
    counter: 'authHttpOutcomes',
    dimensions: ['statusCode', 'category']
  }
})

const CACHE_EVENT_PREFIXES = Object.freeze({
  'user-role-cache.': 'authUserRoleCacheEvents',
  'role-definitions-cache.': 'authRoleDefinitionsCacheEvents'
})

/**
 * Maps a token-validation failure reason to a coarse, bounded category for metric dimensions.
 *
 * @param {string} reason an `AccessTokenFailure` value
 * @returns {string}
 */
export function tokenFailureCategory(reason) {
  const F = AccessTokenFailure
  const categories = {
    [F.MISSING_AUTHORIZATION_HEADER]: 'missing',
    [F.MALFORMED_AUTHORIZATION_HEADER]: 'malformed',
    [F.UNSUPPORTED_AUTHENTICATION_SCHEME]: 'malformed',
    [F.MALFORMED_TOKEN]: 'malformed',
    [F.DISALLOWED_ALGORITHM]: 'algorithm',
    [F.MISSING_KEY_ID]: 'key',
    [F.SIGNING_KEY_NOT_FOUND]: 'key',
    [F.SIGNING_KEY_UNAVAILABLE]: 'key-source',
    [F.INVALID_SIGNATURE]: 'signature',
    [F.MISSING_ISSUER]: 'issuer',
    [F.INVALID_ISSUER]: 'issuer',
    [F.MISSING_AUDIENCE]: 'audience',
    [F.INVALID_AUDIENCE]: 'audience',
    [F.EXPIRED_TOKEN]: 'expired',
    [F.TOKEN_NOT_YET_VALID]: 'not-yet-valid',
    [F.MALFORMED_TIME_CLAIM]: 'malformed',
    [F.MISSING_REQUIRED_CLAIM]: 'malformed',
    [F.AUTHENTICATION_NOT_CONFIGURED]: 'key-source'
  }

  return categories[reason] ?? 'identity-claim-or-unexpected'
}

const isSafeValue = (value) =>
  typeof value === 'boolean' ||
  (typeof value === 'number' && Number.isFinite(value)) ||
  (typeof value === 'string' && SAFE_TEXT.test(value))

function sanitise(fields) {
  const safe = {}
  for (const name of LOG_FIELDS) {
    if (isSafeValue(fields?.[name])) {
      safe[name] = fields[name]
    }
  }
  return safe
}

function metricsFor(safe) {
  const prefix = Object.keys(CACHE_EVENT_PREFIXES).find((candidate) =>
    safe.event?.startsWith(candidate)
  )
  if (prefix) {
    const result = safe.event.slice(prefix.length)
    return CACHE_EVENT_PREFIXES[prefix] && CACHE_RESULTS.includes(result)
      ? { counter: CACHE_EVENT_PREFIXES[prefix], dimensions: { result } }
      : null
  }

  const definition = EVENTS[safe.event]
  if (!definition) {
    return null
  }

  const dimensions = {}
  for (const name of definition.dimensions) {
    if (safe[name] !== undefined) {
      dimensions[name] = String(safe[name])
    }
  }
  return { ...definition, dimensions }
}

/**
 * The single security-telemetry sink. It is a drop-in structured logger (`debug`/`info`/`warn`/`error`
 * taking `(fields, message)`) that
 *  - keeps only allow-listed, bounded, safe fields (no token, claim, identifier, role, URL or error),
 *  - writes one structured log line through the repository logger, and
 *  - counts the event, and records its latency, through the existing `@defra/cdp-metrics` instance using
 *    only enumerated, low-cardinality dimensions (never a correlation id or an arbitrary value).
 *
 * Telemetry can never change a decision: every failure of the log or metric sink is swallowed.
 *
 * @param {{ logger?: object, metrics?: { counter: Function, millis: Function } }} options
 */
export function createSecurityTelemetry({ logger, metrics } = {}) {
  function emit(level, fields, message) {
    try {
      const safe = sanitise(fields)
      logger?.[level]?.(
        safe,
        typeof message === 'string' ? message : safe.event
      )

      const definition = metricsFor(safe)
      if (definition && metrics) {
        Promise.resolve(
          metrics.counter(definition.counter, 1, definition.dimensions)
        ).catch(() => {})
        if (definition.millis && typeof safe.durationMs === 'number') {
          Promise.resolve(
            metrics.millis(
              definition.millis,
              safe.durationMs,
              definition.dimensions
            )
          ).catch(() => {})
        }
      }
    } catch {
      // Observability must never alter the outcome of a protected request
    }
  }

  return {
    debug: (fields, message) => emit('debug', fields, message),
    info: (fields, message) => emit('info', fields, message),
    warn: (fields, message) => emit('warn', fields, message),
    error: (fields, message) => emit('error', fields, message)
  }
}
