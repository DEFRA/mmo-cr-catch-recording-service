// Catch Record domain-decision contract and stable decision-code catalogue (Step 08).
//
// A domain decision is always `{ allowed, code, reason, details? }` — frozen, deterministic, and never a
// thrown error for an expected denial. `details` is optional, small, and safe: never a complete record,
// audit reason, artifact key, stack trace, or cause.
export const LIFECYCLE_DECISION_CODES = Object.freeze([
  'LIFECYCLE_OPERATION_ALLOWED',
  'PERSISTED_STATUS_UNSUPPORTED',
  'DOMAIN_STATE_INCONSISTENT',
  'DRAFT_ABANDONMENT_NOT_ALLOWED',
  'FIRST_SUBMISSION_NOT_ALLOWED',
  'AMENDMENT_NOT_ALLOWED',
  'RESUBMISSION_NOT_ALLOWED',
  'COMPLETION_NOT_ALLOWED',
  'SUBMISSION_COUNT_INVALID',
  'SUBMISSION_COUNT_LIMIT_REACHED',
  'UNSUBMITTED_CHANGES_STATE_INVALID',
  'AUDIT_EXPECTATION_NOT_MET',
  'ARTIFACT_EXPECTATION_NOT_MET'
])

export function isLifecycleDecisionCode(code) {
  return LIFECYCLE_DECISION_CODES.includes(code)
}

function assertCode(code) {
  if (!isLifecycleDecisionCode(code)) {
    throw new Error(`Unsupported lifecycle decision code: "${code}"`)
  }
}

export function createAllowedDecision(
  code = 'LIFECYCLE_OPERATION_ALLOWED',
  reason,
  details
) {
  assertCode(code)

  const decision = { allowed: true, code, reason }

  if (details !== undefined) {
    decision.details = Object.freeze({ ...details })
  }

  return Object.freeze(decision)
}

export function createDeniedDecision(code, reason, details) {
  assertCode(code)

  const decision = { allowed: false, code, reason }

  if (details !== undefined) {
    decision.details = Object.freeze({ ...details })
  }

  return Object.freeze(decision)
}
