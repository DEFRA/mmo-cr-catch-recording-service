import { deriveDisplayStatus } from '#/catch-recording/domain/display-status.js'
import { evaluateGearsProgress } from '#/catch-recording/domain/gear-completeness.js'

/**
 * Step 22: the standard save-response contract shared by every approved Phase 5 Catch Record save
 * operation (first draft creation - Step 18, and generic section PATCH - Step 20/21), extended by Step 26
 * with multi-gear completeness and domain-progress facts. `buildSectionCompletion`/`buildProgress` are
 * also exported and reused directly by Step 29's complete-retrieval response and Step 30's complete
 * mobile-replacement response, so completeness/progress derivation stays defined in exactly one place.
 *
 * Maps only from the already-committed, persisted canonical result - never recalculates persistence or
 * repeats domain validation. Exposes only approved public-safe domain facts: no frontend URL, route
 * name, screen identifier, navigation instruction, internal persistence/history metadata, or raw
 * Reference Data Service response ever reaches this shape.
 *
 * @param {import('#/catch-recording/domain/canonical-catch-record.js').CatchRecord} catchRecord the
 *   committed, persisted canonical record
 * @param {string|null} [savedSection] the canonical section name just saved (`null` for first draft
 *   creation, where no single section was saved in isolation)
 * @returns {Readonly<object>} The approved standard save response.
 */
export function buildStandardSaveResponse(catchRecord, savedSection = null) {
  return Object.freeze({
    id: catchRecord.id,
    catchRecordReference: catchRecord.catchRecordReference,
    status: catchRecord.status,
    displayStatus: deriveDisplayStatus(catchRecord),
    version: catchRecord.version,
    savedSection,
    sectionCompletion: buildSectionCompletion(catchRecord),
    progress: buildProgress(catchRecord)
  })
}

function hasValue(value) {
  return typeof value === 'string' && value.length > 0
}

function isTripComplete(trip) {
  const hasTripDates = hasValue(trip.dateStarted) && hasValue(trip.dateEnded)
  const hasDeparturePort = typeof trip.departurePort?.id === 'string'
  const hasReturnPort = typeof trip.returnPort?.id === 'string'

  return hasTripDates && hasDeparturePort && hasReturnPort
}

function isPairFishingSectionComplete(pairFishing) {
  if (pairFishing.enabled === false) {
    return true
  }

  if (pairFishing.enabled !== true) {
    return false
  }

  return (
    hasValue(pairFishing.pairVessel) && hasValue(pairFishing.pairSkipperName)
  )
}

/**
 * The approved section-completion facts - whether each journey section currently holds the minimum data
 * the canonical contract requires for that section to be considered complete. `gears` (Step 26) is
 * `true` only when every gear association is itself complete (see `evaluateGearsProgress`); root-level
 * `speciesNotLanded` completeness is not yet an approved contract concern and is not represented here.
 *
 * @param {import('#/catch-recording/domain/canonical-catch-record.js').CatchRecord} catchRecord
 * @returns {Readonly<{ trip: boolean, pairFishing: boolean, gears: boolean }>}
 */
export function buildSectionCompletion(catchRecord) {
  const trip = catchRecord.trip ?? {}
  const pairFishing = catchRecord.pairFishing ?? {}

  return Object.freeze({
    trip: isTripComplete(trip),
    pairFishing: isPairFishingSectionComplete(pairFishing),
    gears: evaluateGearsProgress(catchRecord.gears).allGearsComplete
  })
}

/**
 * The approved domain-progress facts, extended by Step 26 with multi-gear completeness
 * (`incompleteGearAssociationIds`, `currentIncompleteGearAssociationId`, `allGearsComplete` - the exact
 * field names already approved for this purpose in the detailed implementation plan). Submission
 * eligibility (`submissionEligible`) is deliberately not composed here - it is not yet an approved Step 22
 * contract field, and complete-record validation (Step 32) remains unevaluated.
 *
 * @param {import('#/catch-recording/domain/canonical-catch-record.js').CatchRecord} catchRecord
 * @returns {Readonly<{ hasUnsubmittedChanges: boolean, numberOfSubmissions: number,
 *   incompleteGearAssociationIds: ReadonlyArray<string>, currentIncompleteGearAssociationId: string|null,
 *   allGearsComplete: boolean }>}
 */
export function buildProgress(catchRecord) {
  const gearsProgress = evaluateGearsProgress(catchRecord.gears)

  return Object.freeze({
    hasUnsubmittedChanges: catchRecord.hasUnsubmittedChanges,
    numberOfSubmissions: catchRecord.numberOfSubmissions,
    incompleteGearAssociationIds: gearsProgress.incompleteGearAssociationIds,
    currentIncompleteGearAssociationId:
      gearsProgress.currentIncompleteGearAssociationId,
    allGearsComplete: gearsProgress.allGearsComplete
  })
}
