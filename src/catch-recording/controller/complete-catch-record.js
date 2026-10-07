import { ApplicationError } from '#/common/helpers/errors/application-error.js'
import { decideCompletionAccess } from '#/catch-recording/security/completion-policy.js'
import { enforcePolicyOutcome } from '#/catch-recording/security/policy-errors.js'
import { canComplete } from '#/catch-recording/domain/lifecycle-transitions.js'
import {
  findCatchRecordById,
  applyCompletion
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
 * Step 36: the restricted completion command (`POST /v1/catch-records/{catchRecordId}/completion`).
 *
 * Deliberately **not** owner-scoped — completion is purely permission-gated
 * (`completion-policy.js`'s `decideCompletionAccess`, no `ownerUserId` parameter by design). No request
 * payload: no completion evidence beyond the approved lifecycle precondition (`SUBMITTED`) is approved
 * anywhere, so none is invented. Targeted idempotency is optional, scoped by the completing actor's own
 * identity (there is no record-owner concept to scope by here).
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

function completionIneligibleError() {
  return new ApplicationError({
    category: 'INVALID_LIFECYCLE_TRANSITION',
    code: 'CATCH_RECORD_COMPLETION_INELIGIBLE',
    message: 'Only a submitted catch record may be completed.'
  })
}

function buildCompletionResponse(catchRecord) {
  return Object.freeze({
    ...buildStandardSaveResponse(catchRecord),
    completedAt: catchRecord.completedAt,
    completedBy: catchRecord.completedBy
  })
}

async function startIdempotencyClaim({
  db,
  actorUserId,
  catchRecordId,
  idempotencyKey,
  expectedVersion
}) {
  const fingerprint = computeRequestFingerprint({
    operationScope: IDEMPOTENCY_OPERATION_SCOPES.COMPLETION,
    idempotencyKey,
    allowedFields: ALLOWED_IDEMPOTENCY_FIELDS,
    semanticInput: { expectedVersion }
  })

  const claim = await claimIdempotency(db, {
    ownerUserId: actorUserId,
    operationScope: IDEMPOTENCY_OPERATION_SCOPES.COMPLETION,
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
 * @returns {Promise<object>} The approved completion response.
 */
export async function completeCatchRecord({
  db,
  authenticationContext,
  catchRecordId,
  expectedVersion,
  idempotencyKey
}) {
  enforcePolicyOutcome(decideCompletionAccess({ authenticationContext }))

  const actorUserId = authenticationContext?.userId

  let idempotency
  if (idempotencyKey) {
    idempotency = await startIdempotencyClaim({
      db,
      actorUserId,
      catchRecordId,
      idempotencyKey,
      expectedVersion
    })

    if (idempotency.claim.outcome === IDEMPOTENCY_CLAIM_OUTCOMES.REPLAY) {
      const existing = await findCatchRecordById(db, { id: catchRecordId })
      if (existing) {
        return buildCompletionResponse(existing)
      }
    }
  }

  const catchRecord = await findCatchRecordById(db, { id: catchRecordId })
  if (!catchRecord) {
    throw catchRecordNotFoundError()
  }

  if (!canComplete(catchRecord).valid) {
    throw completionIneligibleError()
  }

  const now = trustedNowIso()

  const updated = await applyCompletion(db, {
    id: catchRecordId,
    expectedVersion,
    completedAt: now,
    completedBy: actorUserId
  })

  if (!updated) {
    throw catchRecordNotFoundError()
  }

  await appendCatchHistoryEvent(db, {
    catchRecordId,
    ownerUserId: updated.ownerUserId,
    eventType: CATCH_HISTORY_EVENT_TYPES.COMPLETED,
    timestamp: now,
    actorUserId
  })

  const response = buildCompletionResponse(updated)

  if (idempotencyKey) {
    await completeIdempotencyClaim(db, {
      ownerUserId: actorUserId,
      operationScope: IDEMPOTENCY_OPERATION_SCOPES.COMPLETION,
      idempotencyKey,
      resourceId: catchRecordId,
      fingerprint: idempotency.fingerprint,
      result: { id: catchRecordId },
      allowedResultFields: ALLOWED_IDEMPOTENCY_RESULT_FIELDS
    })
  }

  return response
}
