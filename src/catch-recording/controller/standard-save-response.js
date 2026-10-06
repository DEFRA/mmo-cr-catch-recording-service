import { deriveDisplayStatus } from '#/catch-recording/domain/display-status.js'

/**
 * Step 22: the standard save-response contract shared by every approved Phase 5 Catch Record save
 * operation (first draft creation - Step 18, and generic section PATCH - Step 20/21).
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
 * The approved Phase 5 section-completion facts - whether each non-gear journey section currently holds
 * the minimum data the canonical contract requires for that section to be considered complete. Gear,
 * statistical-area, species, catch-detail, and landing completeness are Phase 6 concerns and are not
 * represented here.
 *
 * @param {import('#/catch-recording/domain/canonical-catch-record.js').CatchRecord} catchRecord
 * @returns {Readonly<{ trip: boolean, pairFishing: boolean }>}
 */
function buildSectionCompletion(catchRecord) {
  const trip = catchRecord.trip ?? {}
  const pairFishing = catchRecord.pairFishing ?? {}

  return Object.freeze({
    trip: isTripComplete(trip),
    pairFishing: isPairFishingSectionComplete(pairFishing)
  })
}

/**
 * The approved Phase 5 domain-progress facts. Deliberately minimal - the broader multi-gear completeness
 * calculation (Step 26) does not exist yet.
 *
 * @param {import('#/catch-recording/domain/canonical-catch-record.js').CatchRecord} catchRecord
 * @returns {Readonly<{ hasUnsubmittedChanges: boolean, numberOfSubmissions: number }>}
 */
function buildProgress(catchRecord) {
  return Object.freeze({
    hasUnsubmittedChanges: catchRecord.hasUnsubmittedChanges,
    numberOfSubmissions: catchRecord.numberOfSubmissions
  })
}
