import { authenticationRequiredError } from './authentication-errors.js'

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0
}

/**
 * Deduplicates a scope collection in first-seen order. Deterministic, order-preserving, and never
 * mutates the input.
 *
 * @param {string[]} scopes
 * @returns {string[]}
 */
function deduplicate(scopes) {
  return [...new Set(scopes)]
}

/**
 * Builds the one, minimal, framework-neutral authentication context from an already-validated
 * Authentication Service actor. Defensively re-validates the shape so this module is safe to use
 * independently of `authentication-client.js` (e.g. in tests, or a future second caller). Raises the
 * same shared `authenticationRequiredError` as the client on a malformed shape - Step 13 does not
 * distinguish a malformed upstream response from a malformed actor at this boundary.
 *
 * The returned context contains only `userId` and `scopes` - no raw token, claim, role, email, profile,
 * or session data. Both the context object and its `scopes` array are frozen, and `scopes` is never the
 * same array reference supplied by the caller.
 *
 * @param {{ actorId: unknown, permissions: unknown }} actor
 * @returns {Readonly<{ userId: string, scopes: ReadonlyArray<string> }>}
 */
export function createAuthenticationContext(actor) {
  const actorId = actor?.actorId
  const permissions = actor?.permissions

  if (!isNonEmptyString(actorId)) {
    throw authenticationRequiredError(
      new Error('Authentication actor is missing a valid actorId')
    )
  }

  if (
    !Array.isArray(permissions) ||
    !permissions.every((permission) => isNonEmptyString(permission))
  ) {
    throw authenticationRequiredError(
      new Error('Authentication actor has a malformed permissions collection')
    )
  }

  return Object.freeze({
    userId: actorId,
    scopes: Object.freeze(deduplicate(permissions))
  })
}
