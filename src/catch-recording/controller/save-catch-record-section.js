import { randomUUID } from 'node:crypto'

import { ApplicationError } from '#/common/helpers/errors/application-error.js'
import { normaliseTrip } from '#/catch-recording/normalization/sections/trip.js'
import { normalisePairFishing } from '#/catch-recording/normalization/sections/pair-fishing.js'
import { normaliseGears } from '#/catch-recording/normalization/sections/gears.js'
import { normaliseSpeciesNotLanded } from '#/catch-recording/normalization/sections/species-not-landed.js'
import { validateTrip } from '#/catch-recording/validation/sections/trip.js'
import { validatePairFishing } from '#/catch-recording/validation/sections/pair-fishing.js'
import { validateGears } from '#/catch-recording/validation/sections/gears.js'
import { validateSpeciesNotLanded } from '#/catch-recording/validation/sections/species-not-landed.js'
import { resolvePort } from '#/catch-recording/reference-data/reference-resolvers.js'
import { getTrustedBusinessDate } from '#/catch-recording/domain/business-date.js'
import {
  applySectionUpdate,
  findCatchRecordByIdForOwner
} from '#/catch-recording/persistence/catch-persistence.js'
import {
  appendCatchHistoryEvent,
  CATCH_HISTORY_EVENT_TYPES
} from '#/catch-recording/persistence/catch-history-persistence.js'
import { isAmendedDraft } from '#/catch-recording/domain/lifecycle-consistency.js'
import { resolveGearsSection } from './gears/resolve-gears-section.js'
import { reconcileGears } from './gears/reconcile-gears.js'
import { resolveSpeciesNotLandedSection } from './resolve-species-not-landed.js'
import { buildStandardSaveResponse } from './standard-save-response.js'

/**
 * Step 20 (generic section PATCH pipeline) + Step 21 (trip, ports, and pair-fishing section handlers),
 * `PATCH /v1/catch-records/{catchRecordId}`.
 *
 * The explicit, current-phase section allow-list. No dynamic/arbitrary property access anywhere in this
 * pipeline: every section name is checked against this closed list before anything else happens, and the
 * normaliser/validator dispatched for it is resolved from an explicit lookup table, never a computed
 * property path built from client input.
 */
export const SECTION_ALLOW_LIST = Object.freeze([
  'trip',
  'pairFishing',
  'gears',
  'speciesNotLanded'
])

const SECTION_NORMALISERS = Object.freeze({
  trip: normaliseTrip,
  pairFishing: normalisePairFishing,
  gears: normaliseGears,
  speciesNotLanded: normaliseSpeciesNotLanded
})

const SECTION_VALIDATORS = Object.freeze({
  trip: validateTrip,
  pairFishing: validatePairFishing,
  gears: validateGears,
  speciesNotLanded: validateSpeciesNotLanded
})

function trustedNowIso() {
  return new Date().toISOString()
}

function unsupportedSectionError() {
  return new ApplicationError({
    category: 'INVALID_REQUEST',
    code: 'UNSUPPORTED_SECTION',
    message: 'The supplied section is not supported.'
  })
}

function sectionValidationError(issues) {
  return new ApplicationError({
    category: 'BUSINESS_VALIDATION_FAILURE',
    code: 'SECTION_VALIDATION_FAILED',
    message: 'The supplied section data is invalid.',
    details: issues
  })
}

function catchRecordNotFoundError() {
  return new ApplicationError({
    category: 'RESOURCE_NOT_FOUND',
    code: 'CATCH_RECORD_NOT_FOUND',
    message: 'The requested catch record could not be found.'
  })
}

/**
 * `startedAndFinishedToday: true` always resolves both dates from the trusted business date - whatever a
 * client supplied for either date is discarded and replaced, never merely validated away (Step 21's
 * approved trusted-business-date rule). Never mutates `trip`.
 *
 * @param {object} trip the already-normalised trip section
 * @param {string} businessTimezone
 * @returns {object} an independent trip object with trusted dates applied when appropriate
 */
function applyTrustedBusinessDate(trip, businessTimezone) {
  if (trip.startedAndFinishedToday !== true) {
    return trip
  }

  const today = getTrustedBusinessDate({ timezone: businessTimezone })
  return { ...trip, dateStarted: today, dateEnded: today }
}

/**
 * Resolves the departure and return port selections through the Step 16 reference-validation/snapshot-
 * resolution boundary. Never trusts a client-supplied snapshot - only the stable `id` survived
 * normalisation, and the approved display snapshot is always resolved fresh from the Reference Data
 * Service at save time. Never mutates `trip`.
 *
 * @param {object} trip the already-normalised, already-validated trip section (so both port `id`s are
 *   confirmed present non-empty strings)
 * @param {object} referenceDataClient
 * @param {string} [correlationId]
 * @returns {Promise<object>} an independent trip object with both ports replaced by `{ id, ...snapshot }`
 * @throws {ApplicationError} `BUSINESS_VALIDATION_FAILURE` when a port cannot be found, is inactive, or
 *   is otherwise invalid; any Reference Data Service dependency failure (timeout/unavailable/malformed
 *   response) is rethrown unchanged.
 */
async function resolveTripPorts(trip, referenceDataClient, correlationId) {
  const resolved = { ...trip }

  for (const field of ['departurePort', 'returnPort']) {
    const selection = trip[field]

    const { result, snapshot } = await resolvePort({
      id: selection.id,
      path: ['trip', field],
      client: referenceDataClient,
      correlationId
    })

    if (!result.valid) {
      throw sectionValidationError(result.issues)
    }

    resolved[field] = { id: selection.id, ...snapshot }
  }

  return resolved
}

/**
 * Step 23's `gears` orchestration, extended by Step 24 to resolve each gear's optional per-gear
 * `statisticalArea` (set/clear/leave-unchanged - see `resolve-gears-section.js`/`reconcile-gears.js`):
 * reads the currently persisted record (to source existing gear identities and nested dependent data for
 * reconciliation only - the atomic `{_id, ownerUserId, version}` predicate on the write below remains the
 * sole concurrency control, so a concurrent change never commits a stale merge; it fails the predicate
 * and yields `VERSION_CONFLICT` instead), resolves every incoming gear/characteristic/statistical-area
 * selection fresh from the Reference Data Service, then reconciles the result against the persisted
 * collection (retain/new/removed, stable server-generated identities, deterministic ordering, never
 * trusting a client snapshot).
 *
 * @param {object} input
 * @param {import('mongodb').Db} input.db
 * @param {unknown} input.normalisedSection the already-normalised, already-validated `gears` collection
 * @param {object} input.referenceDataClient
 * @param {string} input.catchRecordId
 * @param {string} input.ownerUserId
 * @param {string} [input.correlationId]
 * @returns {Promise<Array<object>>} the reconciled `gears` collection to persist
 * @throws {ApplicationError} `RESOURCE_NOT_FOUND` when the record does not exist for this owner;
 *   `BUSINESS_VALIDATION_FAILURE` when a gear/characteristic cannot be resolved or an incoming
 *   `associationId` is unknown; any Reference Data Service dependency failure is rethrown unchanged.
 */
async function resolveGearsSectionValue({
  db,
  normalisedSection,
  referenceDataClient,
  catchRecordId,
  ownerUserId,
  correlationId
}) {
  const existing = await findCatchRecordByIdForOwner(db, {
    id: catchRecordId,
    ownerUserId
  })

  if (!existing) {
    throw catchRecordNotFoundError()
  }

  const resolvedIncomingGears = await resolveGearsSection(
    normalisedSection,
    referenceDataClient,
    correlationId
  )

  const { gears } = reconcileGears({
    resolvedIncomingGears,
    existingGears: existing.gears,
    generateAssociationId: randomUUID
  })

  return gears
}

/**
 * Dispatches to each section's save-time snapshot-resolution/reconciliation behaviour. `trip`, `gears`,
 * and `speciesNotLanded` all resolve authoritative snapshots fresh from the Reference Data Service at
 * save time, never trusting a client-supplied snapshot; `gears` additionally reconciles against the
 * persisted collection (Step 23). Every other section's already-normalised/validated value is used
 * as-is.
 */
async function resolveSectionValue({
  db,
  section,
  normalisedSection,
  referenceDataClient,
  catchRecordId,
  ownerUserId,
  correlationId
}) {
  if (section === 'trip') {
    return resolveTripPorts(
      normalisedSection,
      referenceDataClient,
      correlationId
    )
  }

  if (section === 'gears') {
    return resolveGearsSectionValue({
      db,
      normalisedSection,
      referenceDataClient,
      catchRecordId,
      ownerUserId,
      correlationId
    })
  }

  if (section === 'speciesNotLanded') {
    return resolveSpeciesNotLandedSection(
      normalisedSection,
      referenceDataClient,
      correlationId
    )
  }

  return normalisedSection
}

/**
 * @param {Object} input
 * @param {import('mongodb').Db} input.db
 * @param {object} input.referenceDataClient Step 15 Reference Data Service client
 * @param {{ userId: string, scopes: ReadonlyArray<string> }} input.authenticationContext
 * @param {string} input.catchRecordId
 * @param {number} input.expectedVersion
 * @param {unknown} input.section the canonical section name (validated against `SECTION_ALLOW_LIST`)
 * @param {unknown} input.data the client-supplied section payload
 * @param {string} input.businessTimezone
 * @param {string} [input.correlationId]
 * @returns {Promise<object>} the approved standard save response (Step 22)
 */
export async function saveCatchRecordSection({
  db,
  referenceDataClient,
  authenticationContext,
  catchRecordId,
  expectedVersion,
  section,
  data,
  businessTimezone,
  correlationId
}) {
  if (!SECTION_ALLOW_LIST.includes(section)) {
    throw unsupportedSectionError()
  }

  const ownerUserId = authenticationContext?.userId
  const normalise = SECTION_NORMALISERS[section]
  const validate = SECTION_VALIDATORS[section]

  let normalisedSection = normalise(data)

  if (section === 'trip') {
    normalisedSection = applyTrustedBusinessDate(
      normalisedSection,
      businessTimezone
    )
  }

  const validationResult = validate(normalisedSection)
  if (!validationResult.valid) {
    throw sectionValidationError(validationResult.issues)
  }

  const sectionValue = await resolveSectionValue({
    db,
    section,
    normalisedSection,
    referenceDataClient,
    catchRecordId,
    ownerUserId,
    correlationId
  })

  const now = trustedNowIso()

  const updated = await applySectionUpdate(db, {
    id: catchRecordId,
    ownerUserId,
    expectedVersion,
    changes: {
      [section]: sectionValue,
      updatedAt: now,
      updatedBy: ownerUserId
    },
    allowedFields: SECTION_ALLOW_LIST
  })

  if (!updated) {
    throw catchRecordNotFoundError()
  }

  // Step 38: an amendment save (the patched record is now an amended draft - `DRAFT` with prior
  // submissions) is recorded as a distinct event type from an ordinary never-submitted-draft section
  // save. Checking the *updated* document (not a separate pre-read) is sufficient: `applySectionUpdate`
  // never touches `numberOfSubmissions`, so its before/after value is identical.
  const eventType = isAmendedDraft(updated)
    ? CATCH_HISTORY_EVENT_TYPES.AMENDMENT_SECTION_SAVED
    : CATCH_HISTORY_EVENT_TYPES.SECTION_SAVED

  await appendCatchHistoryEvent(db, {
    catchRecordId,
    ownerUserId,
    eventType,
    timestamp: now,
    actorUserId: ownerUserId,
    metadata: { section }
  })

  return buildStandardSaveResponse(updated, section)
}
