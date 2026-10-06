import {
  allowOutcome,
  denyOutcome,
  POLICY_DECISIONS
} from './policy-outcome.js'

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0
}

/**
 * The single low-level Catch Record ownership check: does the trusted caller's `userId` exactly match
 * the canonical `ownerUserId`? Both are treated as opaque identifiers - no case-normalisation, no
 * trimming, no partial matching. Exported for explicit composition (the step prompt: "The pure policy
 * remains available where explicit composition is required").
 *
 * Denies with `NOT_FOUND`, not `ACCESS_DENIED`, on any missing, malformed, or mismatched owner - the
 * same horizontal-disclosure-safe posture already used by Step 09's owner-scoped persistence (returning
 * no accessible resource rather than confirming another owner's record exists).
 *
 * Only own-enumerable allow-listed properties are read; an inherited or prototype-chain `userId`/
 * `ownerUserId` is never trusted.
 *
 * @param {{ authenticationContext: { userId?: unknown } | null | undefined, ownerUserId: unknown }} input
 * @returns {Readonly<{ decision: string }>}
 */
export function decideOwnership({ authenticationContext, ownerUserId } = {}) {
  const userId =
    authenticationContext && Object.hasOwn(authenticationContext, 'userId')
      ? authenticationContext.userId
      : undefined

  if (!isNonEmptyString(userId)) {
    return denyOutcome(POLICY_DECISIONS.AUTHENTICATION_REQUIRED)
  }

  if (!isNonEmptyString(ownerUserId)) {
    return denyOutcome(POLICY_DECISIONS.NOT_FOUND)
  }

  return userId === ownerUserId
    ? allowOutcome()
    : denyOutcome(POLICY_DECISIONS.NOT_FOUND)
}
