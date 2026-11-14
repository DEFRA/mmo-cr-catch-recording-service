/**
 * Stable, API-independent outcomes of OIDC metadata / JWKS / signing-key resolution. They are consumed
 * by token validation (a later step), which decides how each maps to an authentication result; nothing
 * here knows about HTTP status codes.
 */
export const SigningKeyFailure = Object.freeze({
  METADATA_UNAVAILABLE: 'METADATA_UNAVAILABLE',
  METADATA_INVALID: 'METADATA_INVALID',
  METADATA_ISSUER_MISMATCH: 'METADATA_ISSUER_MISMATCH',
  JWKS_UNAVAILABLE: 'JWKS_UNAVAILABLE',
  JWKS_INVALID: 'JWKS_INVALID',
  NO_USABLE_SIGNING_KEYS: 'NO_USABLE_SIGNING_KEYS',
  KEY_NOT_FOUND: 'KEY_NOT_FOUND',
  REFRESH_THROTTLED: 'REFRESH_THROTTLED',
  REQUEST_TIMEOUT: 'REQUEST_TIMEOUT',
  REQUEST_CANCELLED: 'REQUEST_CANCELLED',
  INTERNAL_ERROR: 'INTERNAL_ERROR'
})

/**
 * Internal control-flow error carrying a {@link SigningKeyFailure} reason. The message is a fixed,
 * safe description: it never contains a response body, a URL, a header, key material or a token.
 */
export class SigningKeyError extends Error {
  constructor(reason, message = reason) {
    super(message)
    this.name = 'SigningKeyError'
    this.reason = reason
  }
}

export function isSigningKeyError(value) {
  return value instanceof SigningKeyError
}
