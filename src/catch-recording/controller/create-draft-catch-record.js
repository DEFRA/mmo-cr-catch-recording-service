import { randomUUID } from 'node:crypto'

import { ApplicationError } from '#/common/helpers/errors/application-error.js'
import {
  CANONICAL_SCHEMA_VERSION,
  NEW_DRAFT_DEFAULTS
} from '#/catch-recording/domain/canonical-catch-record.js'
import { PERSISTED_STATUSES } from '#/catch-recording/domain/lifecycle-status.js'
import {
  generateCatchRecordReference,
  isValidCatchRecordReferenceFormat
} from '#/catch-recording/domain/catch-record-reference.js'
import { resolveVessel } from '#/catch-recording/reference-data/vessel-resolution.js'
import {
  createCatchRecord,
  findCatchRecordByIdForOwner,
  findCatchRecordByReference,
  MIN_EXPECTED_VERSION
} from '#/catch-recording/persistence/catch-persistence.js'
import { duplicateCatchRecordReferenceError } from '#/catch-recording/persistence/catch-persistence-errors.js'
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
 * (Step 10). Never trusts a client-supplied owner, audit, status, or version value.
 *
 * Step 43 adds one further, narrowly-scoped exception to "never trusts a client-supplied ... reference
 * value": the caller may optionally supply `catchRecordReference` on this one creation request. When
 * supplied it is validated against the exact same approved format the generator itself produces
 * (`CATCH_RECORD_REFERENCE_PATTERN`) and checked for uniqueness before being persisted as-is; when
 * omitted, behaviour is unchanged - the service generates it (Step 17). Once persisted, the field reverts
 * to being fully server-owned and immutable (`SERVER_OWNED_FIELDS` already blocks it from every other
 * endpoint).
 */

const DRAFT_CREATION_ALLOWED_FIELDS = Object.freeze([
  'vesselId',
  'catchRecordReference'
])
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

function validateSuppliedCatchRecordReferenceFormat(catchRecordReference) {
  if (!isValidCatchRecordReferenceFormat(catchRecordReference)) {
    throw new ApplicationError({
      category: 'INVALID_REQUEST',
      code: 'CATCH_RECORD_REFERENCE_INVALID_FORMAT',
      message: 'The supplied catch record reference is not in a valid format.'
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
  vesselId,
  catchRecordReference
}) {
  const fingerprint = computeRequestFingerprint({
    operationScope: IDEMPOTENCY_OPERATION_SCOPES.DRAFT_CREATION,
    idempotencyKey,
    allowedFields: DRAFT_CREATION_ALLOWED_FIELDS,
    semanticInput: {
      vesselId,
      ...(catchRecordReference ? { catchRecordReference } : {})
    }
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

async function referenceAlreadyExists(db, candidate) {
  return Boolean(
    await findCatchRecordByReference(db, { catchRecordReference: candidate })
  )
}

/**
 * Resolves the friendly reference for a new draft: reuses a valid, unique client-supplied value
 * (Step 43) as-is, or falls back to the Step 17 generator when none is supplied.
 *
 * @param {Object} input
 * @param {import('mongodb').Db} input.db
 * @param {string|undefined} input.catchRecordReference client-supplied reference, already
 *   format-validated by `validateSuppliedCatchRecordReferenceFormat`
 * @param {object} input.vessel the resolved, authorised vessel
 * @param {string} input.businessTimezone approved business timezone
 * @returns {Promise<string>}
 */
async function resolveCatchRecordReference({
  db,
  catchRecordReference,
  vessel,
  businessTimezone
}) {
  if (catchRecordReference) {
    if (await referenceAlreadyExists(db, catchRecordReference)) {
      throw duplicateCatchRecordReferenceError()
    }

    return catchRecordReference
  }

  return generateCatchRecordReference({
    rss: vessel.rssSnapshot,
    timezone: businessTimezone,
    referenceExists: (candidate) => referenceAlreadyExists(db, candidate)
  })
}

/**
 * @param {Object} input
 * @param {import('mongodb').Db} input.db
 * @param {object} input.referenceDataClient Step 15 Reference Data Service client
 * @param {{ userId: string, scopes: ReadonlyArray<string> }} input.authenticationContext
 * @param {unknown} input.vesselId client-supplied vessel selection
 * @param {string|undefined} [input.catchRecordReference] optional client-supplied friendly reference
 *   (Step 43). When omitted, the service generates one as before.
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
  catchRecordReference: suppliedCatchRecordReference,
  idempotencyKey,
  businessTimezone,
  correlationId
}) {
  requireVesselId(vesselId)

  if (suppliedCatchRecordReference) {
    validateSuppliedCatchRecordReferenceFormat(suppliedCatchRecordReference)
  }

  const ownerUserId = authenticationContext?.userId

  let idempotency
  if (idempotencyKey) {
    idempotency = await startIdempotencyClaim({
      db,
      ownerUserId,
      idempotencyKey,
      vesselId,
      catchRecordReference: suppliedCatchRecordReference
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

  const catchRecordReference = await resolveCatchRecordReference({
    db,
    catchRecordReference: suppliedCatchRecordReference,
    vessel,
    businessTimezone
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
