import {
  ApplicationError,
  isApplicationError
} from '#/common/helpers/errors/application-error.js'
import { validateSubmissionReadiness } from '#/catch-recording/validation/submission-readiness.js'
import { calculateNextSubmissionNumber } from '#/catch-recording/domain/submission-number.js'
import {
  canSubmitFirstTime,
  canResubmit
} from '#/catch-recording/domain/lifecycle-transitions.js'
import {
  findCatchRecordByIdForOwner,
  applySubmission
} from '#/catch-recording/persistence/catch-persistence.js'
import {
  appendCatchHistoryEvent,
  CATCH_HISTORY_EVENT_TYPES
} from '#/catch-recording/persistence/catch-history-persistence.js'
import {
  claimIdempotency,
  completeIdempotencyClaim,
  IDEMPOTENCY_CLAIM_OUTCOMES
} from '#/catch-recording/persistence/catch-idempotency-persistence.js'
import { IDEMPOTENCY_OPERATION_SCOPES } from '#/catch-recording/persistence/idempotency-operation-scope.js'
import { computeRequestFingerprint } from '#/catch-recording/persistence/idempotency-fingerprint.js'
import {
  storeSubmissionArtifacts,
  retrieveCommittedArtifact,
  ARTIFACT_TYPES
} from '#/catch-recording/artifact/catch-artifact.js'
import { generateSubmissionReceiptPdf } from '#/catch-recording/pdf/pdf-generator.js'
import { buildStandardSaveResponse } from './standard-save-response.js'

/**
 * Step 34/38: the `CatchSubmission` idempotent submission use case (`POST
 * /v1/catch-records/{catchRecordId}/submission`), reused identically for first submission and
 * resubmission of an amended draft - the same function, the same persistence primitive, the same
 * artifact pipeline, differing only in which lifecycle policy accepted it and which history event type
 * is appended.
 *
 * Orchestrates, in the approved order: an owner-scoped existing-record read, optional targeted
 * idempotency (replaying a prior completed result unchanged), lifecycle eligibility (Step 08's
 * `canSubmitFirstTime`/`canResubmit`), complete validation (Step 32's `validateSubmissionReadiness`),
 * deterministic submission-number calculation, deterministic-recovery-aware snapshot construction,
 * sequential JSON-then-PDF artifact commitment (Step 33), atomic `SUBMITTED` commitment (Step 34's
 * `applySubmission`), and append-only history.
 */

const ALLOWED_IDEMPOTENCY_FIELDS = Object.freeze(['expectedVersion'])
const ALLOWED_IDEMPOTENCY_RESULT_FIELDS = Object.freeze(['id'])

function trustedNowIso() {
  return new Date().toISOString()
}

function catchRecordNotFoundError() {
  return new ApplicationError({
    category: 'RESOURCE_NOT_FOUND',
    code: 'CATCH_RECORD_NOT_FOUND',
    message: 'The requested catch record could not be found.'
  })
}

function submissionIneligibleError() {
  return new ApplicationError({
    category: 'INVALID_LIFECYCLE_TRANSITION',
    code: 'CATCH_RECORD_SUBMISSION_INELIGIBLE',
    message:
      'Only a never-submitted draft or an amended draft may be submitted.'
  })
}

function submissionValidationError(issues) {
  return new ApplicationError({
    category: 'BUSINESS_VALIDATION_FAILURE',
    code: 'SUBMISSION_VALIDATION_FAILED',
    message: 'The catch record is not ready for submission.',
    details: issues
  })
}

async function startIdempotencyClaim({
  db,
  ownerUserId,
  catchRecordId,
  idempotencyKey,
  operationScope,
  expectedVersion
}) {
  const fingerprint = computeRequestFingerprint({
    operationScope,
    idempotencyKey,
    allowedFields: ALLOWED_IDEMPOTENCY_FIELDS,
    semanticInput: { expectedVersion }
  })

  const claim = await claimIdempotency(db, {
    ownerUserId,
    operationScope,
    idempotencyKey,
    resourceId: catchRecordId,
    fingerprint
  })

  if (claim.outcome === IDEMPOTENCY_CLAIM_OUTCOMES.IN_PROGRESS) {
    throw new ApplicationError({
      category: 'IDEMPOTENCY_CONFLICT',
      code: 'IDEMPOTENCY_REQUEST_IN_PROGRESS',
      message: 'An identical request is already being processed.'
    })
  }

  return { fingerprint, claim }
}

/**
 * The approved submission response: the existing standard save response, extended with the submission
 * facts a caller needs to confirm what was just committed. `savedSection` stays `null` - no single
 * section applies to a whole-record submission.
 *
 * @param {object} catchRecord the committed, persisted canonical record
 * @returns {Readonly<object>}
 */
function buildSubmissionResponse(catchRecord) {
  return Object.freeze({
    ...buildStandardSaveResponse(catchRecord),
    submittedAt: catchRecord.submittedAt,
    submittedBy: catchRecord.submittedBy,
    artifacts: catchRecord.artifacts
  })
}

/**
 * Builds the exact immutable snapshot that will be stored as the JSON artifact and used to generate the
 * PDF receipt. Excludes `artifacts` (which describes the submission, not itself - including it would be
 * self-referential) and the purely mechanical `version` counter (an optimistic-concurrency detail, not
 * business evidence). Never mutates `catchRecord`.
 *
 * @param {object} catchRecord the authoritative persisted record (pre-commit)
 * @param {{ submissionNumber: number, submittedAt: string, submittedBy: string }} facts
 * @returns {object}
 */
function buildImmutableSnapshot(
  catchRecord,
  { submissionNumber, submittedAt, submittedBy }
) {
  const { artifacts, version, ...businessFields } = catchRecord

  return {
    ...businessFields,
    status: 'SUBMITTED',
    numberOfSubmissions: submissionNumber,
    hasUnsubmittedChanges: false,
    submittedAt,
    submittedBy,
    updatedAt: submittedAt,
    updatedBy: submittedBy
  }
}

/**
 * Deterministic-recovery-aware snapshot resolution: if a prior attempt already committed the JSON
 * snapshot for this exact `(catchRecordId, submissionNumber)` before crashing (e.g. before the database
 * commit completed), that committed snapshot is the authoritative one - it is fetched and reused
 * unchanged rather than rebuilt with a new timestamp, so the subsequent artifact commit calls see
 * byte-identical content and safely reuse the existing objects instead of raising an integrity conflict.
 * Only a genuine "not found" is treated as "no prior attempt"; any other artifact-retrieval failure
 * propagates unchanged.
 *
 * @returns {Promise<object>} the snapshot to use (fresh or recovered)
 */
async function resolveSubmissionSnapshot({
  catchArtifactStore,
  catchRecord,
  catchRecordId,
  submissionNumber,
  ownerUserId
}) {
  try {
    const existingJson = await retrieveCommittedArtifact(catchArtifactStore, {
      catchRecordId,
      submissionNumber,
      type: ARTIFACT_TYPES.JSON_SNAPSHOT
    })
    return JSON.parse(existingJson.body.toString('utf8'))
  } catch (error) {
    if (!(
      isApplicationError(error) && error.code === 'CATCH_ARTIFACT_NOT_FOUND'
    )) {
      throw error
    }
  }

  return buildImmutableSnapshot(catchRecord, {
    submissionNumber,
    submittedAt: trustedNowIso(),
    submittedBy: ownerUserId
  })
}

/**
 * @param {Object} input
 * @param {import('mongodb').Db} input.db
 * @param {object} input.referenceDataClient the Step 15 Reference Data Service client
 * @param {object} input.catchArtifactStore the Step 33 `CatchArtifact` storage adapter
 * @param {{ userId: string, scopes: ReadonlyArray<string> }} input.authenticationContext
 * @param {string} input.catchRecordId
 * @param {number} input.expectedVersion
 * @param {string|undefined} input.idempotencyKey optional `Idempotency-Key` header value
 * @param {number} [input.maxPdfRenderedItems]
 * @param {string} [input.correlationId]
 * @returns {Promise<object>} The approved submission response.
 */
export async function submitCatchRecord({
  db,
  referenceDataClient,
  catchArtifactStore,
  authenticationContext,
  catchRecordId,
  expectedVersion,
  idempotencyKey,
  maxPdfRenderedItems,
  correlationId
}) {
  const ownerUserId = authenticationContext?.userId

  const catchRecord = await findCatchRecordByIdForOwner(db, {
    id: catchRecordId,
    ownerUserId
  })

  if (!catchRecord) {
    throw catchRecordNotFoundError()
  }

  const isResubmission = canResubmit(catchRecord).valid

  // Idempotency replay is checked before lifecycle eligibility: a retried request whose first attempt
  // already succeeded will find the record no longer `DRAFT`, which would otherwise fail the lifecycle
  // check before ever reaching the stored replay result.
  let idempotency
  if (idempotencyKey) {
    idempotency = await startIdempotencyClaim({
      db,
      ownerUserId,
      catchRecordId,
      idempotencyKey,
      operationScope: isResubmission
        ? IDEMPOTENCY_OPERATION_SCOPES.RESUBMISSION
        : IDEMPOTENCY_OPERATION_SCOPES.SUBMISSION,
      expectedVersion
    })

    if (idempotency.claim.outcome === IDEMPOTENCY_CLAIM_OUTCOMES.REPLAY) {
      const existing = await findCatchRecordByIdForOwner(db, {
        id: catchRecordId,
        ownerUserId
      })
      if (existing) {
        return buildSubmissionResponse(existing)
      }
    }
  }

  if (!canSubmitFirstTime(catchRecord).valid && !isResubmission) {
    throw submissionIneligibleError()
  }

  const validationResult = await validateSubmissionReadiness(catchRecord, {
    referenceDataClient,
    authenticationContext,
    correlationId
  })

  if (!validationResult.valid) {
    throw submissionValidationError(validationResult.issues)
  }

  const submissionNumber = calculateNextSubmissionNumber(
    catchRecord.numberOfSubmissions
  )

  const snapshot = await resolveSubmissionSnapshot({
    catchArtifactStore,
    catchRecord,
    catchRecordId,
    submissionNumber,
    ownerUserId
  })

  const jsonBody = Buffer.from(JSON.stringify(snapshot, null, 2), 'utf8')
  const { body: pdfBody } = await generateSubmissionReceiptPdf(snapshot, {
    maxRenderedItems: maxPdfRenderedItems
  })

  const newArtifactMetadata = await storeSubmissionArtifacts(
    catchArtifactStore,
    {
      catchRecordId,
      submissionNumber,
      jsonBody,
      pdfBody
    }
  )

  const updated = await applySubmission(db, {
    id: catchRecordId,
    ownerUserId,
    expectedVersion,
    submissionNumber,
    artifacts: [...catchRecord.artifacts, ...newArtifactMetadata],
    submittedAt: snapshot.submittedAt,
    submittedBy: snapshot.submittedBy,
    updatedAt: snapshot.submittedAt,
    updatedBy: snapshot.submittedBy
  })

  if (!updated) {
    throw catchRecordNotFoundError()
  }

  await appendCatchHistoryEvent(db, {
    catchRecordId,
    ownerUserId,
    eventType: isResubmission
      ? CATCH_HISTORY_EVENT_TYPES.RESUBMITTED
      : CATCH_HISTORY_EVENT_TYPES.SUBMITTED,
    timestamp: snapshot.submittedAt,
    actorUserId: ownerUserId,
    metadata: { submissionNumber }
  })

  const response = buildSubmissionResponse(updated)

  if (idempotencyKey) {
    await completeIdempotencyClaim(db, {
      ownerUserId,
      operationScope: isResubmission
        ? IDEMPOTENCY_OPERATION_SCOPES.RESUBMISSION
        : IDEMPOTENCY_OPERATION_SCOPES.SUBMISSION,
      idempotencyKey,
      resourceId: catchRecordId,
      fingerprint: idempotency.fingerprint,
      result: { id: catchRecordId },
      allowedResultFields: ALLOWED_IDEMPOTENCY_RESULT_FIELDS
    })
  }

  return response
}
