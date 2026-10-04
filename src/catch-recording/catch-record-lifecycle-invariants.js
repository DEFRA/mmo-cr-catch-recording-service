import { CATCH_RECORD_STATUS } from './canonical-catch-record-status.js'
import {
  createAllowedDecision,
  createDeniedDecision
} from './catch-record-lifecycle-decision.js'

// Catch Record lifecycle invariants and transition catalogue (Step 08).
//
// `evaluateLifecycleInvariant` recognises exactly the approved state shapes (see
// design/architecture/catch-record-lifecycle-and-domain-rules.md §13 for the full decision evidence,
// including the user-approved two-sub-shape "amended draft" resolution) and reports every other
// combination as DOMAIN_STATE_INCONSISTENT — it never silently repairs an inconsistent state.
//
// `CATCH_RECORD_LIFECYCLE_TRANSITIONS` is read-only reference data consumed only by documentation and
// tests; it is NOT an executable `canTransition(from, to)` dispatcher, which the Step 08 prompt explicitly
// forbids as "one unrestricted function that accepts an arbitrary target status".
export const CATCH_RECORD_LIFECYCLE_TRANSITIONS = Object.freeze([
  Object.freeze({
    from: null,
    to: CATCH_RECORD_STATUS.DRAFT,
    trigger: 'persistentCreation'
  }),
  Object.freeze({
    from: CATCH_RECORD_STATUS.DRAFT,
    to: CATCH_RECORD_STATUS.SUBMITTED,
    trigger: 'firstSubmission'
  }),
  Object.freeze({
    from: CATCH_RECORD_STATUS.SUBMITTED,
    to: CATCH_RECORD_STATUS.COMPLETE,
    trigger: 'completion'
  }),
  Object.freeze({
    from: CATCH_RECORD_STATUS.SUBMITTED,
    to: CATCH_RECORD_STATUS.DRAFT,
    trigger: 'editStart'
  }),
  Object.freeze({
    from: CATCH_RECORD_STATUS.COMPLETE,
    to: CATCH_RECORD_STATUS.DRAFT,
    trigger: 'editStart'
  }),
  Object.freeze({
    from: CATCH_RECORD_STATUS.DRAFT,
    to: CATCH_RECORD_STATUS.SUBMITTED,
    trigger: 'resubmission'
  })
])

function isNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0
}

function isSupportedPersistedStatus(status) {
  return (
    status === CATCH_RECORD_STATUS.DRAFT ||
    status === CATCH_RECORD_STATUS.SUBMITTED ||
    status === CATCH_RECORD_STATUS.COMPLETE
  )
}

// Validates the three basic input shapes shared by every lifecycle-invariant state, extracted to keep
// `evaluateLifecycleInvariant` itself within the approved cyclomatic-complexity limit. Returns a denied
// decision for the first basic violation found, or `null` when the input is well-formed enough to proceed
// to state-specific invariant evaluation.
function findBasicInvariantViolation({
  status,
  numberOfSubmissions,
  hasUnsubmittedChanges
}) {
  if (!isSupportedPersistedStatus(status)) {
    return createDeniedDecision(
      'PERSISTED_STATUS_UNSUPPORTED',
      'The supplied status is not an approved persisted status.',
      { status }
    )
  }

  if (!isNonNegativeInteger(numberOfSubmissions)) {
    return createDeniedDecision(
      'DOMAIN_STATE_INCONSISTENT',
      'numberOfSubmissions must be a non-negative integer.',
      { status }
    )
  }

  if (typeof hasUnsubmittedChanges !== 'boolean') {
    return createDeniedDecision(
      'DOMAIN_STATE_INCONSISTENT',
      'hasUnsubmittedChanges must be a boolean.',
      { status }
    )
  }

  return null
}

export function evaluateLifecycleInvariant(input) {
  const basicViolation = findBasicInvariantViolation(input)

  if (basicViolation) {
    return basicViolation
  }

  const { status, numberOfSubmissions, hasUnsubmittedChanges } = input

  // Never-submitted draft.
  if (status === CATCH_RECORD_STATUS.DRAFT && numberOfSubmissions === 0) {
    if (hasUnsubmittedChanges === false) {
      return createAllowedDecision(
        'LIFECYCLE_OPERATION_ALLOWED',
        'A never-submitted draft is a consistent lifecycle state.'
      )
    }

    return createDeniedDecision(
      'DOMAIN_STATE_INCONSISTENT',
      'A never-submitted draft cannot have pending unsubmitted changes.',
      { status, numberOfSubmissions }
    )
  }

  // Amended draft — two valid sub-shapes per the user-approved decision (see the Step 08 saved plan's
  // "Pre-implementation ambiguity resolved" section): hasUnsubmittedChanges may be true OR false.
  if (status === CATCH_RECORD_STATUS.DRAFT && numberOfSubmissions > 0) {
    return createAllowedDecision(
      'LIFECYCLE_OPERATION_ALLOWED',
      'An amended draft is a consistent lifecycle state regardless of hasUnsubmittedChanges.'
    )
  }

  // Submitted / complete records require numberOfSubmissions > 0 and hasUnsubmittedChanges === false.
  if (numberOfSubmissions === 0) {
    return createDeniedDecision(
      'DOMAIN_STATE_INCONSISTENT',
      `${status} with zero submissions is an inconsistent lifecycle state.`,
      { status, numberOfSubmissions }
    )
  }

  if (hasUnsubmittedChanges === true) {
    return createDeniedDecision(
      'DOMAIN_STATE_INCONSISTENT',
      `${status} must not have pending unsubmitted changes.`,
      { status, numberOfSubmissions }
    )
  }

  return createAllowedDecision(
    'LIFECYCLE_OPERATION_ALLOWED',
    `A ${status.toLowerCase()} record is a consistent lifecycle state.`
  )
}
