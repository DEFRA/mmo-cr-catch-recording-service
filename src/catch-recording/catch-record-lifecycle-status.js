import { CATCH_RECORD_STATUS } from './canonical-catch-record-status.js'
import {
  createAllowedDecision,
  createDeniedDecision
} from './catch-record-lifecycle-decision.js'

// Catch Record display-status contract and derivation (Step 08).
//
// Display status is a derived, read-only concept — it is never persisted, never added to the Canonical
// Catch Record Object v1, and never accepted as authority for a lifecycle transition. See
// design/design/catch-recording-service-design.md §8.1 and
// design/github-prompts/step-08-implement-lifecycle-and-domain-rules.md §2-3.
export const CATCH_RECORD_DISPLAY_STATUS = Object.freeze({
  DRAFT: 'Draft',
  AMENDED: 'Amended',
  SUBMITTED: 'Submitted',
  COMPLETE: 'Complete'
})

function isNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0
}

const DISPLAY_STATUS_DERIVED_REASON =
  'The display status was derived successfully.'

export function deriveDisplayStatus({ status, numberOfSubmissions }) {
  if (
    status !== CATCH_RECORD_STATUS.DRAFT &&
    status !== CATCH_RECORD_STATUS.SUBMITTED &&
    status !== CATCH_RECORD_STATUS.COMPLETE
  ) {
    return createDeniedDecision(
      'PERSISTED_STATUS_UNSUPPORTED',
      'The supplied status is not an approved persisted status.',
      { status }
    )
  }

  if (!isNonNegativeInteger(numberOfSubmissions)) {
    return createDeniedDecision(
      'SUBMISSION_COUNT_INVALID',
      'numberOfSubmissions must be a non-negative integer.'
    )
  }

  if (status === CATCH_RECORD_STATUS.SUBMITTED) {
    return createAllowedDecision(
      'LIFECYCLE_OPERATION_ALLOWED',
      DISPLAY_STATUS_DERIVED_REASON,
      { displayStatus: CATCH_RECORD_DISPLAY_STATUS.SUBMITTED }
    )
  }

  if (status === CATCH_RECORD_STATUS.COMPLETE) {
    return createAllowedDecision(
      'LIFECYCLE_OPERATION_ALLOWED',
      DISPLAY_STATUS_DERIVED_REASON,
      { displayStatus: CATCH_RECORD_DISPLAY_STATUS.COMPLETE }
    )
  }

  const displayStatus =
    numberOfSubmissions > 0
      ? CATCH_RECORD_DISPLAY_STATUS.AMENDED
      : CATCH_RECORD_DISPLAY_STATUS.DRAFT

  return createAllowedDecision(
    'LIFECYCLE_OPERATION_ALLOWED',
    DISPLAY_STATUS_DERIVED_REASON,
    {
      displayStatus
    }
  )
}
