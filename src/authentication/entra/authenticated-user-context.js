import { ENTRA_AUTH_STRATEGY } from './entra-auth-strategy.js'

// The identifier is treated as an opaque value (`oid` is a GUID, `sub` is an opaque base64url string, and
// the claim is configurable), so only a bounded, URL-path-safe character set is enforced; no case folding.
const MAXIMUM_USER_ID_LENGTH = 128
const USER_ID_FORMAT = /^[A-Za-z0-9._~-]+$/

export const UserContextFailure = Object.freeze({
  USER_ID_CLAIM_NOT_CONFIGURED: 'USER_ID_CLAIM_NOT_CONFIGURED',
  MISSING_USER_ID_CLAIM: 'MISSING_USER_ID_CLAIM',
  INVALID_USER_ID_CLAIM_TYPE: 'INVALID_USER_ID_CLAIM_TYPE',
  INVALID_USER_ID_FORMAT: 'INVALID_USER_ID_FORMAT'
})

// Only contexts built by this module count as an authenticated user, so no other principal (for
// example a legacy mock principal) can satisfy the contract by shape alone.
const trustedContexts = new WeakSet()

const failure = (reason) => ({ ok: false, reason })

/** Own, non-null claim value, or `undefined` when the claim is absent. */
function readOwnClaim(claims, name) {
  if (claims === null || typeof claims !== 'object') {
    return undefined
  }

  return Object.hasOwn(claims, name) ? (claims[name] ?? undefined) : undefined
}

/**
 * Builds the minimal immutable authenticated-user context from the claims of a fully validated token.
 * Uses exactly the configured identity claim - there is no fallback claim - and fails for a missing,
 * null, non-string, multi-valued, empty, whitespace, over-long or malformed value. Nothing else from the
 * token (claims, roles, scopes, token) is copied.
 *
 * @param {Readonly<Record<string, unknown>>} validatedClaims claims returned by a successful validation
 * @param {string | null} userIdClaim the configured `entra.userIdClaim`
 * @returns {{ ok: true, user: Readonly<{ userId: string }> } | { ok: false, reason: string }}
 */
export function createAuthenticatedUserContext(validatedClaims, userIdClaim) {
  if (typeof userIdClaim !== 'string' || userIdClaim.length === 0) {
    return failure(UserContextFailure.USER_ID_CLAIM_NOT_CONFIGURED)
  }

  const value = readOwnClaim(validatedClaims, userIdClaim)
  if (value === undefined) {
    return failure(UserContextFailure.MISSING_USER_ID_CLAIM)
  }

  if (typeof value !== 'string') {
    return failure(UserContextFailure.INVALID_USER_ID_CLAIM_TYPE)
  }

  if (value.length > MAXIMUM_USER_ID_LENGTH || !USER_ID_FORMAT.test(value)) {
    return failure(UserContextFailure.INVALID_USER_ID_FORMAT)
  }

  const user = Object.freeze({ userId: value })
  trustedContexts.add(user)

  return { ok: true, user }
}

/**
 * True only for a context created by {@link createAuthenticatedUserContext}.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export function isAuthenticatedUserContext(value) {
  return trustedContexts.has(value)
}

/**
 * The single narrow accessor for the trusted caller of a request. Returns the context only when the
 * request was authenticated by the Entra strategy with a context built by this module, otherwise `null`.
 * Never reads a body, query, route parameter, header or cookie.
 *
 * @param {import('@hapi/hapi').Request} request
 * @returns {Readonly<{ userId: string }> | null}
 */
export function getAuthenticatedUser(request) {
  const { auth } = request

  return auth?.isAuthenticated &&
    auth.strategy === ENTRA_AUTH_STRATEGY &&
    isAuthenticatedUserContext(auth.credentials)
    ? auth.credentials
    : null
}
