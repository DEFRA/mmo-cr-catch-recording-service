import { CATCH_RECORD_STATUS } from './canonical-catch-record-status.js'
import {
  createAllowedDecision,
  createDeniedDecision
} from './catch-record-lifecycle-decision.js'

// Catch Record operation-specific eligibility and calculation policies (Step 08).
//
// Each named policy accepts only the minimum canonical fields it needs, returns a deterministic domain
// decision (never throws for an expected denial), never mutates its input, and never reads the clock,
// randomness, persistence, or the network. There is deliberately no single unrestricted
// `canTransition(from, to)` function — see
// design/architecture/catch-record-lifecycle-and-domain-rules.md §7.
function isNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0
}

export function canAbandonDraft({ status, numberOfSubmissions } = {}) {
  if (status === CATCH_RECORD_STATUS.DRAFT && numberOfSubmissions === 0) {
    return createAllowedDecision(
      'LIFECYCLE_OPERATION_ALLOWED',
      'A never-submitted draft is eligible for abandonment.'
    )
  }

  return createDeniedDecision(
    'DRAFT_ABANDONMENT_NOT_ALLOWED',
    'Only a never-submitted draft is eligible for abandonment.',
    { status, numberOfSubmissions }
  )
}

export function canSubmitFirstVersion({ status, numberOfSubmissions } = {}) {
  if (status === CATCH_RECORD_STATUS.DRAFT && numberOfSubmissions === 0) {
    return createAllowedDecision(
      'LIFECYCLE_OPERATION_ALLOWED',
      'A never-submitted draft is eligible for first submission.'
    )
  }

  return createDeniedDecision(
    'FIRST_SUBMISSION_NOT_ALLOWED',
    'Only a never-submitted draft is eligible for first submission.',
    { status, numberOfSubmissions }
  )
}

export function canStartAmendment({ status, numberOfSubmissions } = {}) {
  const isSubmittedOrComplete =
    status === CATCH_RECORD_STATUS.SUBMITTED ||
    status === CATCH_RECORD_STATUS.COMPLETE

  if (isSubmittedOrComplete && numberOfSubmissions > 0) {
    return createAllowedDecision(
      'LIFECYCLE_OPERATION_ALLOWED',
      'A submitted or complete record with at least one submission is eligible for amendment.'
    )
  }

  return createDeniedDecision(
    'AMENDMENT_NOT_ALLOWED',
    'Only a submitted or complete record with at least one submission is eligible for amendment.',
    { status, numberOfSubmissions }
  )
}

export function resolvePreviousStatusForAmendment(status) {
  if (
    status === CATCH_RECORD_STATUS.SUBMITTED ||
    status === CATCH_RECORD_STATUS.COMPLETE
  ) {
    return createAllowedDecision(
      'LIFECYCLE_OPERATION_ALLOWED',
      'The previous official status was resolved.',
      { previousStatus: status }
    )
  }

  return createDeniedDecision(
    'AMENDMENT_NOT_ALLOWED',
    'Amendment is not supported from this status.',
    { status }
  )
}

export function canResubmit({ status, numberOfSubmissions } = {}) {
  if (status === CATCH_RECORD_STATUS.DRAFT && numberOfSubmissions > 0) {
    return createAllowedDecision(
      'LIFECYCLE_OPERATION_ALLOWED',
      'A draft with prior submissions is eligible for resubmission.'
    )
  }

  return createDeniedDecision(
    'RESUBMISSION_NOT_ALLOWED',
    'Only a draft with prior submissions is eligible for resubmission.',
    { status, numberOfSubmissions }
  )
}

export function canMarkComplete({ status, numberOfSubmissions } = {}) {
  if (status === CATCH_RECORD_STATUS.SUBMITTED && numberOfSubmissions > 0) {
    return createAllowedDecision(
      'LIFECYCLE_OPERATION_ALLOWED',
      'A submitted record with at least one submission is eligible for completion.'
    )
  }

  return createDeniedDecision(
    'COMPLETION_NOT_ALLOWED',
    'Only a submitted record with at least one submission is eligible for completion.',
    { status, numberOfSubmissions }
  )
}

export function calculateNextSubmissionNumber(
  currentNumberOfSubmissions,
  { maxSubmissions } = {}
) {
  if (
    !isNonNegativeInteger(currentNumberOfSubmissions) ||
    !Number.isSafeInteger(currentNumberOfSubmissions)
  ) {
    return createDeniedDecision(
      'SUBMISSION_COUNT_INVALID',
      'The current submission count must be a non-negative safe integer.'
    )
  }

  const next = currentNumberOfSubmissions + 1

  if (typeof maxSubmissions === 'number' && next > maxSubmissions) {
    return createDeniedDecision(
      'SUBMISSION_COUNT_LIMIT_REACHED',
      'The configured maximum submission count would be exceeded.',
      { maxSubmissions }
    )
  }

  return createAllowedDecision(
    'LIFECYCLE_OPERATION_ALLOWED',
    'The next submission number was calculated.',
    { nextSubmissionNumber: next }
  )
}

// Declarative expectation tables (documentation/verification aids — not state mutators). See
// design/architecture/catch-record-lifecycle-and-domain-rules.md §11-12.
export const SUBMISSION_COUNT_EXPECTATIONS = Object.freeze({
  newDraftCreation: 0,
  firstSuccessfulSubmission: 1,
  eachSuccessfulResubmissionIncrementsBy: 1,
  editStartChangesCount: false,
  amendmentSaveChangesCount: false,
  completionChangesCount: false,
  failedSubmissionChangesCount: false,
  queryOrArtifactRetrievalChangesCount: false
})

export const UNSUBMITTED_CHANGES_EXPECTATIONS = Object.freeze({
  newDraftCreation: false,
  preSubmissionSave: false,
  successfulFirstSubmission: false,
  completion: false,
  editStart: true,
  amendmentSave: true,
  successfulResubmission: false
})

export function evaluateAuditExpectation({
  status,
  numberOfSubmissions,
  editEventCount
}) {
  if (!isNonNegativeInteger(editEventCount)) {
    return createDeniedDecision(
      'AUDIT_EXPECTATION_NOT_MET',
      'The edit-event count must be a non-negative integer.'
    )
  }

  // A never-submitted draft may have zero edit events; every other approved state may also have zero (an
  // amendment appends at most one event per edit-start, which is not performed by this step), so this
  // check only guards against a structurally impossible negative/non-integer count, per the prompt's own
  // "Never-submitted draft may have no edit events" and "do not append events" requirements.
  return createAllowedDecision(
    'LIFECYCLE_OPERATION_ALLOWED',
    'The audit expectation is structurally consistent with this state.',
    { status, numberOfSubmissions, editEventCount }
  )
}

export function evaluateArtifactExpectation({
  status,
  numberOfSubmissions,
  artifactCount
}) {
  if (!isNonNegativeInteger(artifactCount)) {
    return createDeniedDecision(
      'ARTIFACT_EXPECTATION_NOT_MET',
      'The artifact count must be a non-negative integer.'
    )
  }

  const isSubmittedOrComplete =
    status === CATCH_RECORD_STATUS.SUBMITTED ||
    status === CATCH_RECORD_STATUS.COMPLETE

  if (isSubmittedOrComplete && numberOfSubmissions > 0 && artifactCount === 0) {
    return createDeniedDecision(
      'ARTIFACT_EXPECTATION_NOT_MET',
      'A submitted or complete record with at least one submission must have artifact metadata.',
      { status, numberOfSubmissions, artifactCount }
    )
  }

  if (numberOfSubmissions === 0 && artifactCount > 0) {
    return createDeniedDecision(
      'ARTIFACT_EXPECTATION_NOT_MET',
      'A record with zero submissions must not claim completed-submission artifacts.',
      { numberOfSubmissions, artifactCount }
    )
  }

  return createAllowedDecision(
    'LIFECYCLE_OPERATION_ALLOWED',
    'The artifact expectation is structurally consistent with this state.',
    { status, numberOfSubmissions, artifactCount }
  )
}
