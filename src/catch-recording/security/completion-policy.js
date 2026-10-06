import {
  allowOutcome,
  denyOutcome,
  POLICY_DECISIONS
} from './policy-outcome.js'

const DEFAULT_REQUIRED_SCOPE = 'catch-recording.complete'

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0
}

function hasExactScope(scopes, requiredScope) {
  return Array.isArray(scopes) && scopes.includes(requiredScope)
}

/**
 * Restricted completion-permission policy. Requires an authenticated caller whose trusted `scopes`
 * collection contains exactly the approved completion scope - an exact, case-sensitive match only, never
 * a substring, prefix, or wildcard match. Deliberately has no `ownerUserId` parameter: per the approved
 * decision (`docs/configuration-decisions.md`), ordinary ownership never grants completion - completion
 * is purely permission-gated, which is also why an unknown or missing scope always denies rather than
 * falling back to any owner-based check. Lifecycle eligibility, expected-version enforcement,
 * idempotency, and completion evidence are all explicitly out of scope here.
 *
 * `requiredScope` is overridable only so the approved placeholder (`catch-recording.complete`) can be
 * renamed in exactly one place later without changing this function's shape - it is not a general
 * permission-name parameter for callers to invent their own values.
 *
 * @param {{ authenticationContext: { userId?: unknown, scopes?: unknown } | null | undefined,
 *   requiredScope?: string }} input
 * @returns {Readonly<{ decision: string }>}
 */
export function decideCompletionAccess({
  authenticationContext,
  requiredScope = DEFAULT_REQUIRED_SCOPE
} = {}) {
  if (!isNonEmptyString(authenticationContext?.userId)) {
    return denyOutcome(POLICY_DECISIONS.AUTHENTICATION_REQUIRED)
  }

  return hasExactScope(authenticationContext.scopes, requiredScope)
    ? allowOutcome()
    : denyOutcome(POLICY_DECISIONS.ACCESS_DENIED)
}
