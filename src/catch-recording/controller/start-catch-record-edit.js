import { ApplicationError } from '#/common/helpers/errors/application-error.js'
import { canStartEdit } from '#/catch-recording/domain/lifecycle-transitions.js'
import {
  findCatchRecordByIdForOwner,
  applyEditStart
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
import { buildStandardSaveResponse } from './standard-save-response.js'

/**
 * Step 37: in-place amendment edit-start (`POST /v1/catch-records/{catchRecordId}/edit-start`).
 *
 * Owner-scoped, exactly like submission (amendment authorisation is ownership-gated, per
 * `docs/catch-recording-authorisation.md`'s "amendment" entry - not permission-gated like completion).
 * No request payload: zero evidence anywhere approves an amendment-reason field, so none is invented.
 * Never clones the record - the same operational document returns to `DRAFT` in place, preserving its ID,
 * friendly reference, submission count, artifacts, and history.
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

function editStartIneligibleError() {
  return new ApplicationError({
    category: 'INVALID_LIFECYCLE_TRANSITION',
    code: 'CATCH_RECORD_EDIT_START_INELIGIBLE',
    message: 'Only a submitted or completed catch record may start an edit.'
  })
}

async function startIdempotencyClaim({
  db,
  ownerUserId,
  catchRecordId,
  idempotencyKey,
  expectedVersion
}) {
  const fingerprint = computeRequestFingerprint({
    operationScope: IDEMPOTENCY_OPERATION_SCOPES.EDIT_START,
    idempotencyKey,
    allowedFields: ALLOWED_IDEMPOTENCY_FIELDS,
    semanticInput: { expectedVersion }
  })

  const claim = await claimIdempotency(db, {
    ownerUserId,
    operationScope: IDEMPOTENCY_OPERATION_SCOPES.EDIT_START,
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
 * @param {Object} input
 * @param {import('mongodb').Db} input.db
 * @param {{ userId: string, scopes: ReadonlyArray<string> }} input.authenticationContext
 * @param {string} input.catchRecordId
 * @param {number} input.expectedVersion
 * @param {string|undefined} input.idempotencyKey optional `Idempotency-Key` header value
 * @returns {Promise<object>} The approved standard save response (Step 22), reflecting `DRAFT` with
 *   `hasUnsubmittedChanges = true`.
 */
export async function startCatchRecordEdit({
  db,
  authenticationContext,
  catchRecordId,
  expectedVersion,
  idempotencyKey
}) {
  const ownerUserId = authenticationContext?.userId

  const catchRecord = await findCatchRecordByIdForOwner(db, {
    id: catchRecordId,
    ownerUserId
  })

  if (!catchRecord) {
    throw catchRecordNotFoundError()
  }

  let idempotency
  if (idempotencyKey) {
    idempotency = await startIdempotencyClaim({
      db,
      ownerUserId,
      catchRecordId,
      idempotencyKey,
      expectedVersion
    })

    if (idempotency.claim.outcome === IDEMPOTENCY_CLAIM_OUTCOMES.REPLAY) {
      const existing = await findCatchRecordByIdForOwner(db, {
        id: catchRecordId,
        ownerUserId
      })
      if (existing) {
        return buildStandardSaveResponse(existing)
      }
    }
  }

  if (!canStartEdit(catchRecord).valid) {
    throw editStartIneligibleError()
  }

  const now = trustedNowIso()

  const updated = await applyEditStart(db, {
    id: catchRecordId,
    ownerUserId,
    expectedVersion,
    updatedAt: now,
    updatedBy: ownerUserId
  })

  if (!updated) {
    throw catchRecordNotFoundError()
  }

  await appendCatchHistoryEvent(db, {
    catchRecordId,
    ownerUserId,
    eventType: CATCH_HISTORY_EVENT_TYPES.EDIT_STARTED,
    timestamp: now,
    actorUserId: ownerUserId
  })

  const response = buildStandardSaveResponse(updated)

  if (idempotencyKey) {
    await completeIdempotencyClaim(db, {
      ownerUserId,
      operationScope: IDEMPOTENCY_OPERATION_SCOPES.EDIT_START,
      idempotencyKey,
      resourceId: catchRecordId,
      fingerprint: idempotency.fingerprint,
      result: { id: catchRecordId },
      allowedResultFields: ALLOWED_IDEMPOTENCY_RESULT_FIELDS
    })
  }

  return response
}
