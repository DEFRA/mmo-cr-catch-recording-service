import { randomUUID } from 'node:crypto'

import { ApplicationError } from '#/common/helpers/errors/application-error.js'
import { normaliseCatchRecord } from '#/catch-recording/normalization/catch-record.js'
import { validateTrip } from '#/catch-recording/validation/sections/trip.js'
import { validatePairFishing } from '#/catch-recording/validation/sections/pair-fishing.js'
import { validateGears } from '#/catch-recording/validation/sections/gears.js'
import { validateSpeciesNotLanded } from '#/catch-recording/validation/sections/species-not-landed.js'
import { combineResults } from '#/catch-recording/validation/validation-result.js'
import { resolvePort } from '#/catch-recording/reference-data/reference-resolvers.js'
import { resolveVessel } from '#/catch-recording/reference-data/vessel-resolution.js'
import { getTrustedBusinessDate } from '#/catch-recording/domain/business-date.js'
import { PERSISTED_STATUSES } from '#/catch-recording/domain/lifecycle-status.js'
import {
  findCatchRecordByIdForOwner,
  applyCompleteReplacement
} from '#/catch-recording/persistence/catch-persistence.js'
import { ineligibleReplacementError } from '#/catch-recording/persistence/catch-persistence-errors.js'
import {
  appendCatchHistoryEvent,
  CATCH_HISTORY_EVENT_TYPES
} from '#/catch-recording/persistence/catch-history-persistence.js'
import { resolveGearsSection } from './gears/resolve-gears-section.js'
import { reconcileGears } from './gears/reconcile-gears.js'
import { resolveSpeciesNotLandedSection } from './resolve-species-not-landed.js'
import { buildStandardSaveResponse } from './standard-save-response.js'

/**
 * Step 30: the `CatchSubmission`-equivalent complete mobile-replacement use case (`PUT
 * /v1/catch-records/{catchRecordId}`).
 *
 * Orchestrates, in the approved order: an owner-scoped existing-record read (also the source of the
 * `gears` reconciliation's "existing" collection and a fast lifecycle fail-fast before any reference-data
 * call), complete-object normalisation (Step 06's `normaliseCatchRecord` - only the five approved
 * client-owned sections ever survive, regardless of what else the payload contains), reusable per-section
 * business validation (Step 07's `validateTrip`/`validatePairFishing`/`validateGears`/
 * `validateSpeciesNotLanded` - the exact same section validators the existing PATCH pipeline already uses
 * - rather than the aggregate `validateCatchRecord`/`validateStructure`, whose `associationId`-required
 * gear-structure rule targets the already-reconciled *persisted* canonical shape, not a pre-reconciliation
 * client payload that may legitimately add a brand-new gear with no client-supplied `associationId` yet),
 * fresh reference-data resolution for every section (never trusting a client-supplied snapshot, exactly
 * mirroring `save-catch-record-section.js`'s save-time resolution), atomic complete replacement (Step 30's
 * `applyCompleteReplacement` - the predicate, not an application read, is the sole concurrency and
 * lifecycle control), and append-only history (one new `COMPLETE_REPLACEMENT_SAVED` event).
 *
 * Never trusts a client-supplied owner, audit, status, version, reference, or artifact value - Joi's
 * root-unknown-property rejection, this module's exclusive use of `normaliseCatchRecord`'s approved
 * section set, and `applyCompleteReplacement`'s own allow-listed `$set` are three independent layers, so
 * no single gap could let a server-owned field reach persistence.
 */

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

function replacementValidationError(issues) {
  return new ApplicationError({
    category: 'BUSINESS_VALIDATION_FAILURE',
    code: 'COMPLETE_REPLACEMENT_VALIDATION_FAILED',
    message: 'The supplied catch record data is invalid.',
    details: issues
  })
}

/**
 * Reuses the exact same reusable per-section business validators the existing PATCH pipeline already
 * dispatches through `SECTION_VALIDATORS` (`save-catch-record-section.js`) - never a second, competing
 * validation implementation. `vessel` has no separate section validator anywhere in the repository; its
 * only approved validation is `resolveVessel`'s own id-presence/reference/access checks, applied later.
 *
 * @param {object} normalisedCatchRecord
 * @throws {ApplicationError} `BUSINESS_VALIDATION_FAILURE` aggregating every section's issues
 */
function validateReplacementSections(normalisedCatchRecord) {
  const combined = combineResults(
    validateTrip(normalisedCatchRecord.trip),
    validatePairFishing(normalisedCatchRecord.pairFishing),
    validateGears(normalisedCatchRecord.gears),
    validateSpeciesNotLanded(normalisedCatchRecord.speciesNotLanded)
  )

  if (!combined.valid) {
    throw replacementValidationError(combined.issues)
  }
}

/**
 * `startedAndFinishedToday: true` always resolves both dates from the trusted business date (mirrors
 * `save-catch-record-section.js`'s identical Step 21 rule). Never mutates `trip`.
 *
 * @param {object} trip the already-normalised trip section
 * @param {string} businessTimezone
 * @returns {object} an independent trip object with trusted dates applied when appropriate
 */
function applyTrustedBusinessDate(trip, businessTimezone) {
  if (trip?.startedAndFinishedToday !== true) {
    return trip
  }

  const today = getTrustedBusinessDate({ timezone: businessTimezone })
  return { ...trip, dateStarted: today, dateEnded: today }
}

/**
 * Resolves the departure/return port selections fresh from the Reference Data Service (mirrors
 * `save-catch-record-section.js`'s identical `resolveTripPorts`). Never mutates `trip`.
 *
 * @param {object} trip the already-normalised, already-validated trip section
 * @param {object} referenceDataClient
 * @param {string} [correlationId]
 * @returns {Promise<object>} an independent trip object with both ports replaced by `{ id, ...snapshot }`
 * @throws {ApplicationError} `BUSINESS_VALIDATION_FAILURE` when a port cannot be resolved
 */
async function resolveTripPorts(trip, referenceDataClient, correlationId) {
  const resolved = { ...trip }
  const issues = []

  for (const field of ['departurePort', 'returnPort']) {
    const selection = trip[field]

    const { result, snapshot } = await resolvePort({
      id: selection?.id,
      path: ['trip', field],
      client: referenceDataClient,
      correlationId
    })

    if (!result.valid) {
      issues.push(...result.issues)
      continue
    }

    resolved[field] = { id: selection.id, ...snapshot }
  }

  if (issues.length > 0) {
    throw replacementValidationError(issues)
  }

  return resolved
}

/**
 * Resolves and re-authorises the vessel selection fresh from the Reference Data Service, exactly
 * mirroring `create-draft-catch-record.js`'s identical draft-creation flow - a complete replacement never
 * trusts a client-supplied vessel snapshot, and vessel access is re-evaluated on every replacement.
 *
 * @param {Object} input
 * @param {unknown} input.vesselId
 * @param {object} input.referenceDataClient
 * @param {{ userId?: unknown }} input.authenticationContext
 * @param {string} [input.correlationId]
 * @returns {Promise<object>} `{ id, ...snapshot }`
 * @throws {ApplicationError} `BUSINESS_VALIDATION_FAILURE` when the vessel cannot be resolved
 */
async function resolveReplacementVessel({
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
    throw replacementValidationError(result.issues)
  }

  return { id: vesselId, ...snapshot }
}

/**
 * Resolves every approved client-owned section fresh from the Reference Data Service and reconciles
 * `gears` against the owner-scoped `existing` record. Never trusts a client-supplied snapshot or a
 * forged `associationId`.
 *
 * @param {object} input
 * @returns {Promise<{ vessel: object, trip: object, pairFishing: object, gears: Array<object>,
 *   speciesNotLanded: Array<object> }>}
 */
async function resolveReplacementSections({
  normalisedCatchRecord,
  existing,
  referenceDataClient,
  authenticationContext,
  businessTimezone,
  correlationId
}) {
  const trimmedTrip = applyTrustedBusinessDate(
    normalisedCatchRecord.trip,
    businessTimezone
  )

  // Resolved sequentially (not concurrently): every other section in this pipeline already resolves
  // sequentially (mirrors `save-catch-record-section.js`'s dispatch model throughout), which keeps
  // reference-data call order deterministic and avoids no benefit from added concurrency complexity here.
  const vessel = await resolveReplacementVessel({
    vesselId: normalisedCatchRecord.vessel?.id,
    referenceDataClient,
    authenticationContext,
    correlationId
  })
  const trip = await resolveTripPorts(
    trimmedTrip,
    referenceDataClient,
    correlationId
  )

  const resolvedIncomingGears = await resolveGearsSection(
    normalisedCatchRecord.gears,
    referenceDataClient,
    correlationId
  )
  const { gears } = reconcileGears({
    resolvedIncomingGears,
    existingGears: existing.gears,
    generateAssociationId: randomUUID
  })

  const speciesNotLanded = await resolveSpeciesNotLandedSection(
    normalisedCatchRecord.speciesNotLanded,
    referenceDataClient,
    correlationId
  )

  return {
    vessel,
    trip,
    pairFishing: normalisedCatchRecord.pairFishing,
    gears,
    speciesNotLanded
  }
}

/**
 * @param {Object} input
 * @param {import('mongodb').Db} input.db
 * @param {object} input.referenceDataClient Step 15 Reference Data Service client
 * @param {{ userId: string, scopes: ReadonlyArray<string> }} input.authenticationContext
 * @param {string} input.catchRecordId
 * @param {number} input.expectedVersion
 * @param {unknown} input.payload the client-supplied complete-replacement payload (already Joi-validated
 *   at the HTTP boundary: a plain object carrying exactly `vessel`, `trip`, `pairFishing`, `gears`, and
 *   `speciesNotLanded`)
 * @param {string} input.businessTimezone
 * @param {string} [input.correlationId]
 * @returns {Promise<object>} the approved standard save response (Step 22)
 * @throws {ApplicationError} `RESOURCE_NOT_FOUND`, `INVALID_LIFECYCLE_TRANSITION`,
 *   `BUSINESS_VALIDATION_FAILURE`, or `VERSION_CONFLICT`
 */
export async function replaceCatchRecord({
  db,
  referenceDataClient,
  authenticationContext,
  catchRecordId,
  expectedVersion,
  payload,
  businessTimezone,
  correlationId
}) {
  const ownerUserId = authenticationContext?.userId

  const existing = await findCatchRecordByIdForOwner(db, {
    id: catchRecordId,
    ownerUserId
  })

  if (!existing) {
    throw catchRecordNotFoundError()
  }

  // Fast-fail before any reference-data call: a non-DRAFT record can never be replaced (Step 37's
  // edit-start, Phase 8, is the only approved way back to DRAFT). `applyCompleteReplacement`'s atomic
  // predicate re-checks this at write time regardless - this is a performance short-circuit only, never
  // the sole lifecycle control.
  if (existing.status !== PERSISTED_STATUSES.DRAFT) {
    throw ineligibleReplacementError()
  }

  const normalisedCatchRecord = normaliseCatchRecord(payload)

  validateReplacementSections(normalisedCatchRecord)

  const resolvedSections = await resolveReplacementSections({
    normalisedCatchRecord,
    existing,
    referenceDataClient,
    authenticationContext,
    businessTimezone,
    correlationId
  })

  const now = trustedNowIso()

  const updated = await applyCompleteReplacement(db, {
    id: catchRecordId,
    ownerUserId,
    expectedVersion,
    changes: {
      ...resolvedSections,
      updatedAt: now,
      updatedBy: ownerUserId
    }
  })

  await appendCatchHistoryEvent(db, {
    catchRecordId,
    ownerUserId,
    eventType: CATCH_HISTORY_EVENT_TYPES.COMPLETE_REPLACEMENT_SAVED,
    timestamp: now,
    actorUserId: ownerUserId
  })

  return buildStandardSaveResponse(updated, null)
}
