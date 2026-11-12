import { decodeProtectedHeader, errors, jwtVerify } from 'jose'

import { BearerTokenFailure, extractBearerToken } from './bearer-token.js'
import { SigningKeyFailure } from './signing-key-failure.js'

export const AccessTokenFailure = Object.freeze({
  ...BearerTokenFailure,
  MALFORMED_TOKEN: 'MALFORMED_TOKEN',
  DISALLOWED_ALGORITHM: 'DISALLOWED_ALGORITHM',
  MISSING_KEY_ID: 'MISSING_KEY_ID',
  SIGNING_KEY_NOT_FOUND: 'SIGNING_KEY_NOT_FOUND',
  SIGNING_KEY_UNAVAILABLE: 'SIGNING_KEY_UNAVAILABLE',
  INVALID_SIGNATURE: 'INVALID_SIGNATURE',
  MISSING_ISSUER: 'MISSING_ISSUER',
  INVALID_ISSUER: 'INVALID_ISSUER',
  MISSING_AUDIENCE: 'MISSING_AUDIENCE',
  INVALID_AUDIENCE: 'INVALID_AUDIENCE',
  EXPIRED_TOKEN: 'EXPIRED_TOKEN',
  TOKEN_NOT_YET_VALID: 'TOKEN_NOT_YET_VALID',
  MALFORMED_TIME_CLAIM: 'MALFORMED_TIME_CLAIM',
  MISSING_REQUIRED_CLAIM: 'MISSING_REQUIRED_CLAIM',
  AUTHENTICATION_NOT_CONFIGURED: 'AUTHENTICATION_NOT_CONFIGURED',
  UNEXPECTED_VALIDATION_FAILURE: 'UNEXPECTED_VALIDATION_FAILURE'
})

/** Who is at fault: the caller's credentials, a dependency, or this service. Never an HTTP status. */
export const FailureSource = Object.freeze({
  CREDENTIALS: 'credentials',
  DEPENDENCY: 'dependency',
  INTERNAL: 'internal'
})

// Entra access tokens must carry these; anything else required for authentication is added by later steps
const REQUIRED_CLAIMS = ['exp', 'iss', 'aud']
const DEFAULT_CLOCK_TOLERANCE_SECONDS = 0

const DEPENDENCY_REASONS = new Set([
  AccessTokenFailure.SIGNING_KEY_UNAVAILABLE,
  AccessTokenFailure.AUTHENTICATION_NOT_CONFIGURED
])

const CLAIM_FAILURES = {
  iss: {
    missing: AccessTokenFailure.MISSING_ISSUER,
    check_failed: AccessTokenFailure.INVALID_ISSUER,
    invalid: AccessTokenFailure.INVALID_ISSUER
  },
  aud: {
    missing: AccessTokenFailure.MISSING_AUDIENCE,
    check_failed: AccessTokenFailure.INVALID_AUDIENCE,
    invalid: AccessTokenFailure.INVALID_AUDIENCE
  },
  exp: {
    missing: AccessTokenFailure.MISSING_REQUIRED_CLAIM,
    check_failed: AccessTokenFailure.EXPIRED_TOKEN,
    invalid: AccessTokenFailure.MALFORMED_TIME_CLAIM
  },
  nbf: {
    check_failed: AccessTokenFailure.TOKEN_NOT_YET_VALID,
    invalid: AccessTokenFailure.MALFORMED_TIME_CLAIM
  }
}

function toFailureReason(error) {
  if (error instanceof errors.JWTExpired) {
    return AccessTokenFailure.EXPIRED_TOKEN
  }
  if (error instanceof errors.JWTClaimValidationFailed) {
    const failures = CLAIM_FAILURES[error.claim]
    return (
      failures?.[error.reason] ??
      failures?.check_failed ??
      AccessTokenFailure.UNEXPECTED_VALIDATION_FAILURE
    )
  }
  if (error instanceof errors.JWSSignatureVerificationFailed) {
    return AccessTokenFailure.INVALID_SIGNATURE
  }
  if (error instanceof errors.JOSEAlgNotAllowed) {
    return AccessTokenFailure.DISALLOWED_ALGORITHM
  }
  if (
    error instanceof errors.JWSInvalid ||
    error instanceof errors.JWTInvalid ||
    error instanceof errors.JOSENotSupported
  ) {
    return AccessTokenFailure.MALFORMED_TOKEN
  }
  return AccessTokenFailure.UNEXPECTED_VALIDATION_FAILURE
}

const failure = (reason, source = FailureSource.CREDENTIALS) =>
  Object.freeze({ ok: false, reason, source })

function sourceOf(reason) {
  if (DEPENDENCY_REASONS.has(reason)) {
    return FailureSource.DEPENDENCY
  }
  return reason === AccessTokenFailure.UNEXPECTED_VALIDATION_FAILURE
    ? FailureSource.INTERNAL
    : FailureSource.CREDENTIALS
}

function deepFreeze(value) {
  if (value !== null && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze)
    Object.freeze(value)
  }
  return value
}

/**
 * Maps a typed signing-key provider failure to an access-token failure. A missing key is the caller's
 * problem; an unavailable metadata/JWKS dependency is kept distinguishable from invalid credentials.
 */
function keyFailureReason(keyResult) {
  const { reason, lastRefreshFailure } = keyResult

  if (reason === SigningKeyFailure.KEY_NOT_FOUND) {
    return AccessTokenFailure.SIGNING_KEY_NOT_FOUND
  }
  if (reason === SigningKeyFailure.REFRESH_THROTTLED && !lastRefreshFailure) {
    return AccessTokenFailure.SIGNING_KEY_NOT_FOUND
  }
  return AccessTokenFailure.SIGNING_KEY_UNAVAILABLE
}

function readProtectedHeader(token, allowedAlgorithms) {
  let header
  try {
    header = decodeProtectedHeader(token)
  } catch {
    return { failureReason: AccessTokenFailure.MALFORMED_TOKEN }
  }

  if (
    typeof header.alg !== 'string' ||
    !allowedAlgorithms.includes(header.alg)
  ) {
    return { failureReason: AccessTokenFailure.DISALLOWED_ALGORITHM }
  }
  if (typeof header.kid !== 'string' || header.kid.length === 0) {
    return { failureReason: AccessTokenFailure.MISSING_KEY_ID }
  }

  return { keyId: header.kid }
}

/**
 * Validates an Entra access token locally. Only a token whose signature, algorithm, exact issuer, exact
 * audience, expiry and not-before all validate yields claims; nothing derived from an unverified token is
 * ever returned. Verification, algorithm restriction and claim checks are delegated to `jose`; signing
 * keys come only from the shared Step 02 provider (a missing provider fails closed).
 *
 * This module establishes no user identity, performs no authorisation and never logs or returns the token.
 *
 * @param {Object} options
 * @param {{ getSigningKey: Function } | null} options.signingKeyProvider
 * @param {string} options.issuer exact expected `iss` (`entra.issuer`)
 * @param {string} options.audience exact expected `aud` (`entra.audience`)
 * @param {string[]} options.allowedAlgorithms `entra.allowedAlgorithms`
 * @param {number} [options.clockToleranceSeconds] explicit bounded clock skew; strict (0) by default
 * @param {() => Date} [options.now] UTC clock; injectable for deterministic tests
 */
export function createAccessTokenValidator({
  signingKeyProvider,
  issuer,
  audience,
  allowedAlgorithms,
  clockToleranceSeconds = DEFAULT_CLOCK_TOLERANCE_SECONDS,
  now = () => new Date()
}) {
  /**
   * @param {unknown} authorizationHeader the raw `Authorization` header value
   * @param {{ signal?: AbortSignal }} [options]
   * @returns {Promise<Readonly<{ ok: true, claims: Readonly<Record<string, unknown>> }
   *   | { ok: false, reason: string, source: string }>>}
   */
  async function validate(authorizationHeader, { signal } = {}) {
    const extracted = extractBearerToken(authorizationHeader)
    if (!extracted.ok) {
      return failure(extracted.reason)
    }

    const { token } = extracted
    const { failureReason, keyId } = readProtectedHeader(
      token,
      allowedAlgorithms
    )
    if (failureReason) {
      return failure(failureReason)
    }

    if (!signingKeyProvider) {
      return failure(
        AccessTokenFailure.AUTHENTICATION_NOT_CONFIGURED,
        FailureSource.DEPENDENCY
      )
    }

    const keyResult = await signingKeyProvider.getSigningKey(keyId, { signal })
    if (!keyResult.ok) {
      const reason = keyFailureReason(keyResult)
      return failure(reason, sourceOf(reason))
    }

    try {
      const { payload } = await jwtVerify(token, keyResult.key, {
        algorithms: allowedAlgorithms,
        issuer,
        audience,
        requiredClaims: REQUIRED_CLAIMS,
        clockTolerance: clockToleranceSeconds,
        currentDate: now()
      })

      return Object.freeze({ ok: true, claims: deepFreeze({ ...payload }) })
    } catch (error) {
      const reason = toFailureReason(error)
      return failure(reason, sourceOf(reason))
    }
  }

  return { validate }
}
