/**
 * The one small, deterministic, framework-neutral policy-outcome contract shared by every resource
 * authorisation policy. Deliberately not an `ApplicationError` itself (pure policies stay side-effect
 * free and composable) - `policy-errors.js` converts a denied outcome into the approved `ApplicationError`
 * only when enforcement is actually requested.
 *
 * An outcome never carries resource data, owner identifiers, vessel permissions, scopes, or tokens - only
 * the bare decision.
 */
export const POLICY_DECISIONS = Object.freeze({
  ALLOWED: 'ALLOWED',
  AUTHENTICATION_REQUIRED: 'AUTHENTICATION_REQUIRED',
  ACCESS_DENIED: 'ACCESS_DENIED',
  NOT_FOUND: 'NOT_FOUND'
})

const DENIAL_DECISIONS = new Set([
  POLICY_DECISIONS.AUTHENTICATION_REQUIRED,
  POLICY_DECISIONS.ACCESS_DENIED,
  POLICY_DECISIONS.NOT_FOUND
])

/**
 * @returns {Readonly<{ decision: 'ALLOWED' }>}
 */
export function allowOutcome() {
  return Object.freeze({ decision: POLICY_DECISIONS.ALLOWED })
}

/**
 * @param {'AUTHENTICATION_REQUIRED'|'ACCESS_DENIED'|'NOT_FOUND'} decision
 * @returns {Readonly<{ decision: string }>}
 */
export function denyOutcome(decision) {
  if (!DENIAL_DECISIONS.has(decision)) {
    throw new TypeError(
      `Unsupported policy denial decision: ${String(decision)}`
    )
  }

  return Object.freeze({ decision })
}

/**
 * @param {{ decision: string }} outcome
 * @returns {boolean}
 */
export function isAllowed(outcome) {
  return outcome?.decision === POLICY_DECISIONS.ALLOWED
}
