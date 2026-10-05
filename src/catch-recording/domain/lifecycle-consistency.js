import { PERSISTED_STATUSES, isPersistedStatus } from './lifecycle-status.js'
import { LIFECYCLE_CODES } from './lifecycle-codes.js'
import {
  createInvalidResult,
  createValidResult,
  formatPath
} from '../validation/validation-result.js'

function issue(pathSegments, message) {
  return {
    code: LIFECYCLE_CODES.INCONSISTENT_STATE,
    path: formatPath(pathSegments),
    message
  }
}

// Reads only an own property - an inherited (prototype-chain) lifecycle field must never be trusted.
function ownField(catchRecord, field) {
  return Object.hasOwn(catchRecord, field) ? catchRecord[field] : undefined
}

function isNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0
}

function hasCommittedArtifacts(catchRecord) {
  const artifacts = ownField(catchRecord, 'artifacts')
  return Array.isArray(artifacts) && artifacts.length > 0
}

function hasNoCommittedArtifacts(catchRecord) {
  const artifacts = ownField(catchRecord, 'artifacts')
  return Array.isArray(artifacts) && artifacts.length === 0
}

/**
 * Returns `true` when `catchRecord` is an amended draft: `status = DRAFT` and `numberOfSubmissions > 0`.
 * Reused by `display-status.js`'s derivation logic and by the lifecycle-transition eligibility checks.
 *
 * @param {unknown} catchRecord
 * @returns {boolean}
 */
export function isAmendedDraft(catchRecord) {
  if (typeof catchRecord !== 'object' || catchRecord === null) {
    return false
  }

  const numberOfSubmissions = ownField(catchRecord, 'numberOfSubmissions')
  return (
    ownField(catchRecord, 'status') === PERSISTED_STATUSES.DRAFT &&
    Number.isInteger(numberOfSubmissions) &&
    numberOfSubmissions > 0
  )
}

/**
 * Invariant: a never-submitted draft — the exact approved new-draft state
 * (`canonical-catch-record-object.md` §5 "New draft").
 *
 * @param {unknown} catchRecord
 * @returns {{ valid: boolean, issues: ReadonlyArray<object> }}
 */
export function isNewDraft(catchRecord) {
  if (typeof catchRecord !== 'object' || catchRecord === null) {
    return createInvalidResult(issue([], 'Invalid Catch Record'))
  }

  const issues = []

  if (ownField(catchRecord, 'status') !== PERSISTED_STATUSES.DRAFT) {
    issues.push(issue(['status'], 'A new draft must have status DRAFT'))
  }

  if (ownField(catchRecord, 'numberOfSubmissions') !== 0) {
    issues.push(
      issue(['numberOfSubmissions'], 'A new draft must have zero submissions')
    )
  }

  if (ownField(catchRecord, 'hasUnsubmittedChanges') !== false) {
    issues.push(
      issue(
        ['hasUnsubmittedChanges'],
        'A new draft must not have unsubmitted changes'
      )
    )
  }

  if (!hasNoCommittedArtifacts(catchRecord)) {
    issues.push(
      issue(['artifacts'], 'A new draft must have no committed artifacts')
    )
  }

  for (const field of [
    'submittedAt',
    'submittedBy',
    'completedAt',
    'completedBy'
  ]) {
    if (ownField(catchRecord, field) !== null) {
      issues.push(
        issue(
          [field],
          'A new draft must not carry submission or completion metadata'
        )
      )
    }
  }

  return issues.length === 0 ? createValidResult() : createInvalidResult(issues)
}

/**
 * Invariant: an amended draft — `status = DRAFT`, `numberOfSubmissions > 0`, prior artifacts preserved,
 * and `hasUnsubmittedChanges = true` (the only route back to `DRAFT` with prior submissions is
 * edit-start, which always sets this).
 *
 * @param {unknown} catchRecord
 * @returns {{ valid: boolean, issues: ReadonlyArray<object> }}
 */
export function isConsistentAmendedState(catchRecord) {
  if (typeof catchRecord !== 'object' || catchRecord === null) {
    return createInvalidResult(issue([], 'Invalid Catch Record'))
  }

  const issues = []
  const numberOfSubmissions = ownField(catchRecord, 'numberOfSubmissions')

  if (ownField(catchRecord, 'status') !== PERSISTED_STATUSES.DRAFT) {
    issues.push(issue(['status'], 'An amended draft must have status DRAFT'))
  }

  if (!isNonNegativeInteger(numberOfSubmissions) || numberOfSubmissions <= 0) {
    issues.push(
      issue(
        ['numberOfSubmissions'],
        'An amended draft must have at least one prior submission'
      )
    )
  }

  if (ownField(catchRecord, 'hasUnsubmittedChanges') !== true) {
    issues.push(
      issue(
        ['hasUnsubmittedChanges'],
        'An amended draft must have unsubmitted changes'
      )
    )
  }

  if (!hasCommittedArtifacts(catchRecord)) {
    issues.push(
      issue(
        ['artifacts'],
        'An amended draft must preserve its prior submission artifacts'
      )
    )
  }

  return issues.length === 0 ? createValidResult() : createInvalidResult(issues)
}

/**
 * Invariant: a submitted record — `status = SUBMITTED`, at least one submission, no unsubmitted
 * changes, current submission metadata present, committed artifact evidence present, and no completion
 * metadata (a record cannot be both `SUBMITTED` and carry completion metadata).
 *
 * @param {unknown} catchRecord
 * @returns {{ valid: boolean, issues: ReadonlyArray<object> }}
 */
export function isConsistentSubmittedState(catchRecord) {
  if (typeof catchRecord !== 'object' || catchRecord === null) {
    return createInvalidResult(issue([], 'Invalid Catch Record'))
  }

  const issues = []
  const numberOfSubmissions = ownField(catchRecord, 'numberOfSubmissions')

  if (ownField(catchRecord, 'status') !== PERSISTED_STATUSES.SUBMITTED) {
    issues.push(
      issue(['status'], 'A submitted record must have status SUBMITTED')
    )
  }

  if (!isNonNegativeInteger(numberOfSubmissions) || numberOfSubmissions < 1) {
    issues.push(
      issue(
        ['numberOfSubmissions'],
        'A submitted record must have at least one submission'
      )
    )
  }

  if (ownField(catchRecord, 'hasUnsubmittedChanges') !== false) {
    issues.push(
      issue(
        ['hasUnsubmittedChanges'],
        'A submitted record must have no unsubmitted changes'
      )
    )
  }

  if (ownField(catchRecord, 'submittedAt') == null) {
    issues.push(
      issue(
        ['submittedAt'],
        'A submitted record must carry current submission metadata'
      )
    )
  }

  if (ownField(catchRecord, 'submittedBy') == null) {
    issues.push(
      issue(
        ['submittedBy'],
        'A submitted record must carry current submission metadata'
      )
    )
  }

  if (!hasCommittedArtifacts(catchRecord)) {
    issues.push(
      issue(
        ['artifacts'],
        'A submitted record must have committed submission artifacts'
      )
    )
  }

  if (ownField(catchRecord, 'completedAt') !== null) {
    issues.push(
      issue(
        ['completedAt'],
        'A submitted record must not carry completion metadata'
      )
    )
  }

  if (ownField(catchRecord, 'completedBy') !== null) {
    issues.push(
      issue(
        ['completedBy'],
        'A submitted record must not carry completion metadata'
      )
    )
  }

  return issues.length === 0 ? createValidResult() : createInvalidResult(issues)
}

/**
 * Invariant: a completed record — `status = COMPLETE`, at least one submission, submission and
 * completion metadata both present, committed artifacts preserved, and no unsubmitted changes.
 *
 * @param {unknown} catchRecord
 * @returns {{ valid: boolean, issues: ReadonlyArray<object> }}
 */
export function isConsistentCompletedState(catchRecord) {
  if (typeof catchRecord !== 'object' || catchRecord === null) {
    return createInvalidResult(issue([], 'Invalid Catch Record'))
  }

  const issues = []
  const numberOfSubmissions = ownField(catchRecord, 'numberOfSubmissions')

  if (ownField(catchRecord, 'status') !== PERSISTED_STATUSES.COMPLETE) {
    issues.push(
      issue(['status'], 'A completed record must have status COMPLETE')
    )
  }

  if (!isNonNegativeInteger(numberOfSubmissions) || numberOfSubmissions < 1) {
    issues.push(
      issue(
        ['numberOfSubmissions'],
        'A completed record must have at least one submission'
      )
    )
  }

  if (ownField(catchRecord, 'hasUnsubmittedChanges') !== false) {
    issues.push(
      issue(
        ['hasUnsubmittedChanges'],
        'A completed record must have no unsubmitted changes'
      )
    )
  }

  for (const field of [
    'submittedAt',
    'submittedBy',
    'completedAt',
    'completedBy'
  ]) {
    if (ownField(catchRecord, field) == null) {
      issues.push(
        issue(
          [field],
          'A completed record must carry submission and completion metadata'
        )
      )
    }
  }

  if (!hasCommittedArtifacts(catchRecord)) {
    issues.push(
      issue(
        ['artifacts'],
        'A completed record must preserve its submission artifacts'
      )
    )
  }

  return issues.length === 0 ? createValidResult() : createInvalidResult(issues)
}

/**
 * Dispatches to the correct invariant check for the record's persisted status, or reports an
 * unsupported/missing status as inconsistent.
 *
 * @param {unknown} catchRecord
 * @returns {{ valid: boolean, issues: ReadonlyArray<object> }}
 */
export function checkLifecycleInvariants(catchRecord) {
  if (typeof catchRecord !== 'object' || catchRecord === null) {
    return createInvalidResult(issue([], 'Invalid Catch Record'))
  }

  const status = ownField(catchRecord, 'status')

  if (!isPersistedStatus(status)) {
    return createInvalidResult(
      issue(['status'], 'Unsupported persisted status')
    )
  }

  if (status === PERSISTED_STATUSES.SUBMITTED) {
    return isConsistentSubmittedState(catchRecord)
  }

  if (status === PERSISTED_STATUSES.COMPLETE) {
    return isConsistentCompletedState(catchRecord)
  }

  // status === DRAFT
  return isAmendedDraft(catchRecord)
    ? isConsistentAmendedState(catchRecord)
    : isNewDraft(catchRecord)
}
