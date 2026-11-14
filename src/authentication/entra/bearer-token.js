const BEARER_SCHEME = 'bearer'
// RFC 6750 b64token: one credential, no whitespace, nothing appended
const BEARER_CREDENTIAL = /^[A-Za-z0-9\-._~+/]+=*$/

export const BearerTokenFailure = Object.freeze({
  MISSING_AUTHORIZATION_HEADER: 'MISSING_AUTHORIZATION_HEADER',
  MALFORMED_AUTHORIZATION_HEADER: 'MALFORMED_AUTHORIZATION_HEADER',
  UNSUPPORTED_AUTHENTICATION_SCHEME: 'UNSUPPORTED_AUTHENTICATION_SCHEME'
})

/**
 * Strictly extracts the bearer credential from an `Authorization` header value. Only the standard
 * header is ever read by callers; the credential is returned byte-for-byte (never trimmed, rewritten or
 * concatenated) and is never logged here.
 *
 * @param {unknown} authorizationHeader
 * @returns {{ ok: true, token: string } | { ok: false, reason: string }}
 */
export function extractBearerToken(authorizationHeader) {
  if (authorizationHeader === undefined || authorizationHeader === '') {
    return {
      ok: false,
      reason: BearerTokenFailure.MISSING_AUTHORIZATION_HEADER
    }
  }

  // A repeated header would be exposed as an array: ambiguous, so never accepted
  if (typeof authorizationHeader !== 'string') {
    return {
      ok: false,
      reason: BearerTokenFailure.MALFORMED_AUTHORIZATION_HEADER
    }
  }

  const separatorIndex = authorizationHeader.indexOf(' ')
  const scheme =
    separatorIndex === -1
      ? authorizationHeader
      : authorizationHeader.slice(0, separatorIndex)

  if (scheme.toLowerCase() !== BEARER_SCHEME) {
    return {
      ok: false,
      reason: /^[A-Za-z]+$/.test(scheme)
        ? BearerTokenFailure.UNSUPPORTED_AUTHENTICATION_SCHEME
        : BearerTokenFailure.MALFORMED_AUTHORIZATION_HEADER
    }
  }

  const token =
    separatorIndex === -1 ? '' : authorizationHeader.slice(separatorIndex + 1)
  if (!BEARER_CREDENTIAL.test(token)) {
    return {
      ok: false,
      reason: BearerTokenFailure.MALFORMED_AUTHORIZATION_HEADER
    }
  }

  return { ok: true, token }
}
