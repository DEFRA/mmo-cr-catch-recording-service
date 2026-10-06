import { randomUUID } from 'node:crypto'

import { ApplicationError } from '#/common/helpers/errors/application-error.js'
import {
  CANONICAL_SCHEMA_VERSION,
  NEW_DRAFT_DEFAULTS
} from '#/catch-recording/domain/canonical-catch-record.js'
import { PERSISTED_STATUSES } from '#/catch-recording/domain/lifecycle-status.js'
import { generateCatchRecordReference } from '#/catch-recording/domain/catch-record-reference.js'
import { resolveVessel } from '#/catch-recording/reference-data/vessel-resolution.js'
import {
  createCatchRecord,
  findCatchRecordByIdForOwner,
  findCatchRecordByReference,
  MIN_EXPECTED_VERSION
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
 * Step 18: first persistent draft Catch Record creation (`POST /v1/catch-records`).
 *
 * Orchestrates, in the approved order: vessel authorisation and resolution (Step 14/15/16, reusing
 * `resolveVessel`), friendly-reference generation (Step 17), canonical initial-draft construction with
 * trusted server-owned metadata, targeted idempotency (Step 12, `DRAFT_CREATION` scope - optional, only
 * applied when the caller supplies an `Idempotency-Key`), persistence (Step 09), and initial history
 * (Step 10). Never trusts a client-supplied owner, audit, status, version, or reference value.
 */

const DRAFT_CREATION_ALLOWED_FIELDS = Object.freeze(['vesselId'])
const DRAFT_CREATION_ALLOWED_RESULT_FIELDS = Object.freeze([
  'id',
  'catchRecordReference'
])

function trustedNowIso() {
  return new Date().toISOString()
}

function requireVesselId(vesselId) {
  if (typeof vesselId !== 'string' || vesselId.trim().length === 0) {
    throw new ApplicationError({
      category: 'INVALID_REQUEST',
      code: 'VESSEL_ID_REQUIRED',
      message: 'A vessel id is required.'
    })
  }
}

function buildNewDraft({ id, catchRecordReference, ownerUserId, vessel }) {
  const now = trustedNowIso()

  return {
    schemaVersion: CANONICAL_SCHEMA_VERSION,
    id,
    catchRecordReference,
    ownerUserId,
    status: PERSISTED_STATUSES.DRAFT,
    version: MIN_EXPECTED_VERSION,
    vessel,
    trip: {},
    pairFishing: { enabled: false, pairVessel: null, pairSkipperName: null },
    gears: [],
    speciesNotLanded: [],
    createdAt: now,
    createdBy: ownerUserId,
    updatedAt: now,
    updatedBy: ownerUserId,
    ...NEW_DRAFT_DEFAULTS
  }
}

async function resolveAuthorisedVessel({
  vesselId,
  referenceDataClient,
  authenticationContext,
  correlationId
}) {
  const accessibleVesselIds = await referenceDataClient.listAccessibleVesselIds(
    { correlationId }
  )

  const { result, snapshot } = await resolveVessel({
    id: vesselId,
    path: ['vessel'],
    client: referenceDataClient,
    authenticationContext,
    accessibleVesselIds,
    correlationId
  })

  if (!result.valid) {
    throw new ApplicationError({
      category: 'BUSINESS_VALIDATION_FAILURE',
      code: 'INVALID_VESSEL_SELECTION',
      message: result.issues[0]?.message ?? 'The selected vessel is invalid.',
      details: result.issues
    })
  }

  return { id: vesselId, ...snapshot }
}

async function startIdempotencyClaim({
  db,
  ownerUserId,
  idempotencyKey,
  vesselId
}) {
  const fingerprint = computeRequestFingerprint({
    operationScope: IDEMPOTENCY_OPERATION_SCOPES.DRAFT_CREATION,
    idempotencyKey,
    allowedFields: DRAFT_CREATION_ALLOWED_FIELDS,
    semanticInput: { vesselId }
  })

  const claim = await claimIdempotency(db, {
    ownerUserId,
    operationScope: IDEMPOTENCY_OPERATION_SCOPES.DRAFT_CREATION,
    idempotencyKey,
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
 * @param {object} input.referenceDataClient Step 15 Reference Data Service client
 * @param {{ userId: string, scopes: ReadonlyArray<string> }} input.authenticationContext
 * @param {unknown} input.vesselId client-supplied vessel selection
 * @param {string|undefined} input.idempotencyKey optional `Idempotency-Key` header value
 * @param {string} input.businessTimezone approved business timezone (`config.get('businessTimezone')`)
 * @param {string} [input.correlationId]
 * @returns {Promise<object>} The approved Step 22 standard save-response shape.
 */
export async function createDraftCatchRecord({
  db,
  referenceDataClient,
  authenticationContext,
  vesselId,
  idempotencyKey,
  businessTimezone,
  correlationId
}) {
  requireVesselId(vesselId)
  const ownerUserId = authenticationContext?.userId

  let idempotency
  if (idempotencyKey) {
    idempotency = await startIdempotencyClaim({
      db,
      ownerUserId,
      idempotencyKey,
      vesselId
    })

    if (idempotency.claim.outcome === IDEMPOTENCY_CLAIM_OUTCOMES.REPLAY) {
      const existing = await findCatchRecordByIdForOwner(db, {
        id: idempotency.claim.result.id,
        ownerUserId
      })

      if (existing) {
        return buildStandardSaveResponse(existing)
      }
    }
  }

  const vessel = await resolveAuthorisedVessel({
    vesselId,
    referenceDataClient,
    authenticationContext,
    correlationId
  })

  const catchRecordReference = await generateCatchRecordReference({
    rss: vessel.rssSnapshot,
    timezone: businessTimezone,
    referenceExists: async (candidate) =>
      Boolean(
        await findCatchRecordByReference(db, {
          catchRecordReference: candidate
        })
      )
  })

  const id = randomUUID()
  const draft = buildNewDraft({
    id,
    catchRecordReference,
    ownerUserId,
    vessel
  })

  const created = await createCatchRecord(db, draft)

  await appendCatchHistoryEvent(db, {
    catchRecordId: id,
    ownerUserId,
    eventType: CATCH_HISTORY_EVENT_TYPES.DRAFT_CREATED,
    timestamp: draft.createdAt,
    actorUserId: ownerUserId
  })

  if (idempotencyKey) {
    await completeIdempotencyClaim(db, {
      ownerUserId,
      operationScope: IDEMPOTENCY_OPERATION_SCOPES.DRAFT_CREATION,
      idempotencyKey,
      fingerprint: idempotency.fingerprint,
      result: { id, catchRecordReference },
      allowedResultFields: DRAFT_CREATION_ALLOWED_RESULT_FIELDS
    })
  }

  return buildStandardSaveResponse(created)
}
