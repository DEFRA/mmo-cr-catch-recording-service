import { copyField } from './object-helpers.js'
import { normaliseVesselSelection } from './sections/vessel.js'
import { normaliseTrip } from './sections/trip.js'
import { normalisePairFishing } from './sections/pair-fishing.js'
import { normaliseGears } from './sections/gears.js'
import { normaliseSpeciesNotLanded } from './sections/species-not-landed.js'

/**
 * Normalises a complete client-owned Catch Record payload by composing the approved section
 * normalisers. The output contains only the approved client-owned sections (`vessel`, `trip`,
 * `pairFishing`, `gears`, `speciesNotLanded`) — no server-owned root field (`schemaVersion`, `id`,
 * `catchRecordReference`, `ownerUserId`, `status`, `version`, `numberOfSubmissions`,
 * `hasUnsubmittedChanges`, `artifacts`, or any audit/submission/completion timestamp or actor) is ever
 * read from `input`, so none can reach output regardless of what a caller supplies. A section that is
 * genuinely absent from `input` stays absent from the output (this composer does not invent a section).
 *
 * @param {unknown} input
 * @returns {unknown}
 */
export function normaliseCatchRecord(input) {
  if (input === undefined || input === null) {
    return input
  }

  if (typeof input !== 'object' || Array.isArray(input)) {
    return input
  }

  const output = {}
  copyField(output, input, 'vessel', normaliseVesselSelection)
  copyField(output, input, 'trip', normaliseTrip)
  copyField(output, input, 'pairFishing', normalisePairFishing)
  copyField(output, input, 'gears', normaliseGears)
  copyField(output, input, 'speciesNotLanded', normaliseSpeciesNotLanded)
  return output
}
