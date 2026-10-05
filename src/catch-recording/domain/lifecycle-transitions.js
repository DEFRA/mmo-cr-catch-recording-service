import { PERSISTED_STATUSES } from './lifecycle-status.js'
import { isAmendedDraft } from './lifecycle-consistency.js'
import { LIFECYCLE_CODES } from './lifecycle-codes.js'
import {
  createInvalidResult,
  createValidResult,
  formatPath
} from '../validation/validation-result.js'

const INVALID_CATCH_RECORD_MESSAGE = 'Invalid Catch Record'

function issue(pathSegments, message) {
  return {
    code: LIFECYCLE_CODES.INELIGIBLE_TRANSITION,
    path: formatPath(pathSegments),
    message
  }
}

function ownField(catchRecord, field) {
  return Object.hasOwn(catchRecord, field) ? catchRecord[field] : undefined
}

function isObject(value) {
  return typeof value === 'object' && value !== null
}

/**
 * Eligibility: a never-submitted draft may be submitted for the first time.
 *
 * @param {unknown} catchRecord
 * @returns {{ valid: boolean, issues: ReadonlyArray<object> }}
 */
export function canSubmitFirstTime(catchRecord) {
  if (!isObject(catchRecord)) {
    return createInvalidResult(issue([], INVALID_CATCH_RECORD_MESSAGE))
  }

  if (ownField(catchRecord, 'status') !== PERSISTED_STATUSES.DRAFT) {
    return createInvalidResult(
      issue(
        ['status'],
        'Only a DRAFT with no prior submissions may be submitted for the first time'
      )
    )
  }

  if (ownField(catchRecord, 'numberOfSubmissions') !== 0) {
    return createInvalidResult(
      issue(
        ['numberOfSubmissions'],
        'First submission requires zero prior submissions'
      )
    )
  }

  return createValidResult()
}

/**
 * Eligibility: only a `SUBMITTED` record may be completed.
 *
 * @param {unknown} catchRecord
 * @returns {{ valid: boolean, issues: ReadonlyArray<object> }}
 */
export function canComplete(catchRecord) {
  if (!isObject(catchRecord)) {
    return createInvalidResult(issue([], INVALID_CATCH_RECORD_MESSAGE))
  }

  if (ownField(catchRecord, 'status') !== PERSISTED_STATUSES.SUBMITTED) {
    return createInvalidResult(
      issue(['status'], 'Only a SUBMITTED record may be completed')
    )
  }

  return createValidResult()
}

/**
 * The domain facts proposed by completion. Deliberately minimal: only the target status. Timestamp,
 * actor, version, and persistence are owned by Step 36 and its dependencies, not this policy.
 *
 * @param {unknown} catchRecord
 * @returns {{ status: string }}
 */
export function buildCompletionFacts(_catchRecord) {
  return { status: PERSISTED_STATUSES.COMPLETE }
}

/**
 * Eligibility: an edit may start from `SUBMITTED` or `COMPLETE` (never from `DRAFT`).
 *
 * @param {unknown} catchRecord
 * @returns {{ valid: boolean, issues: ReadonlyArray<object> }}
 */
export function canStartEdit(catchRecord) {
  if (!isObject(catchRecord)) {
    return createInvalidResult(issue([], INVALID_CATCH_RECORD_MESSAGE))
  }

  const status = ownField(catchRecord, 'status')
  if (
    status !== PERSISTED_STATUSES.SUBMITTED &&
    status !== PERSISTED_STATUSES.COMPLETE
  ) {
    return createInvalidResult(
      issue(
        ['status'],
        'An edit may only start from a SUBMITTED or COMPLETE record'
      )
    )
  }

  return createValidResult()
}

/**
 * The domain facts proposed by edit-start. Preserves identity (`id`, `catchRecordReference`), submission
 * count, and prior artifact metadata; sets `status` to `DRAFT` and `hasUnsubmittedChanges` to `true`.
 * `completedAt`/`completedBy` are preserved unchanged (owner decision, Step 08 plan) rather than cleared
 * — editing never clones the record or discards its history.
 *
 * @param {unknown} catchRecord
 * @returns {object}
 */
export function buildEditStartFacts(catchRecord) {
  return {
    id: ownField(catchRecord, 'id'),
    catchRecordReference: ownField(catchRecord, 'catchRecordReference'),
    numberOfSubmissions: ownField(catchRecord, 'numberOfSubmissions'),
    artifacts: ownField(catchRecord, 'artifacts'),
    status: PERSISTED_STATUSES.DRAFT,
    hasUnsubmittedChanges: true,
    completedAt: ownField(catchRecord, 'completedAt'),
    completedBy: ownField(catchRecord, 'completedBy')
  }
}

/**
 * Eligibility: only an amended draft (`DRAFT` with `numberOfSubmissions > 0`) may be resubmitted. A
 * never-submitted draft is eligible for first submission instead, not resubmission.
 *
 * @param {unknown} catchRecord
 * @returns {{ valid: boolean, issues: ReadonlyArray<object> }}
 */
export function canResubmit(catchRecord) {
  if (!isObject(catchRecord)) {
    return createInvalidResult(issue([], INVALID_CATCH_RECORD_MESSAGE))
  }

  if (!isAmendedDraft(catchRecord)) {
    return createInvalidResult(
      issue(
        ['status'],
        'Only an amended draft (DRAFT with a prior submission) may be resubmitted'
      )
    )
  }

  return createValidResult()
}

/**
 * The domain facts proposed by a successful resubmission: target status `SUBMITTED`, the next
 * submission number, and `hasUnsubmittedChanges` cleared. Does not include `artifacts` — writing the
 * new artifact metadata is a later step's responsibility; this policy neither writes artifacts nor
 * discards the existing ones.
 *
 * @param {unknown} catchRecord
 * @param {number} nextSubmissionNumber
 * @returns {object}
 */
export function buildResubmissionFacts(_catchRecord, nextSubmissionNumber) {
  return {
    status: PERSISTED_STATUSES.SUBMITTED,
    numberOfSubmissions: nextSubmissionNumber,
    hasUnsubmittedChanges: false
  }
}

/**
 * Eligibility: only a never-submitted draft (`DRAFT`, zero submissions, no committed artifacts) may be
 * abandoned. An amended draft, a submitted record, and a completed record are all ineligible.
 *
 * @param {unknown} catchRecord
 * @returns {{ valid: boolean, issues: ReadonlyArray<object> }}
 */
export function canAbandon(catchRecord) {
  if (!isObject(catchRecord)) {
    return createInvalidResult(issue([], INVALID_CATCH_RECORD_MESSAGE))
  }

  if (ownField(catchRecord, 'status') !== PERSISTED_STATUSES.DRAFT) {
    return createInvalidResult(
      issue(['status'], 'Only a DRAFT may be abandoned')
    )
  }

  if (ownField(catchRecord, 'numberOfSubmissions') !== 0) {
    return createInvalidResult(
      issue(
        ['numberOfSubmissions'],
        'Only a never-submitted draft may be abandoned'
      )
    )
  }

  if (
    ownField(catchRecord, 'submittedAt') != null ||
    ownField(catchRecord, 'submittedBy') != null
  ) {
    return createInvalidResult(
      issue(
        ['submittedAt'],
        'A draft with prior submission metadata may not be abandoned'
      )
    )
  }

  const artifacts = ownField(catchRecord, 'artifacts')
  if (!Array.isArray(artifacts) || artifacts.length > 0) {
    return createInvalidResult(
      issue(
        ['artifacts'],
        'A draft with committed submission evidence may not be abandoned'
      )
    )
  }

  return createValidResult()
}
