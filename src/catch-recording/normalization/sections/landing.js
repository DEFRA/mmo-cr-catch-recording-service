import { normaliseTrimmedString } from '../primitives.js'
import { copyField, normaliseArray } from '../object-helpers.js'

function normaliseCatchDetail(input) {
  if (input === undefined || input === null) {
    return input
  }

  if (typeof input !== 'object' || Array.isArray(input)) {
    return input
  }

  const output = {}
  copyField(output, input, 'attributeId', normaliseTrimmedString)
  copyField(output, input, 'value')
  copyField(output, input, 'unitSnapshot', normaliseTrimmedString)
  return output
}

function normaliseRetainedSpecies(input) {
  if (input === undefined || input === null) {
    return input
  }

  if (typeof input !== 'object' || Array.isArray(input)) {
    return input
  }

  const output = {}
  // References an existing gear/species association already represented under `gears` - Step 06
  // preserves the reference exactly as supplied; it does not verify the reference exists (that is a
  // later step's reconciliation/validation responsibility), and it does not infer or generate one.
  copyField(output, input, 'gearAssociationId', normaliseTrimmedString)
  copyField(output, input, 'speciesAssociationId', normaliseTrimmedString)
  // `species` (FAO code/name snapshot) in the full canonical object is a server-resolved display
  // snapshot derived from the referenced gear's `speciesCaught` entry, not client-owned input - it is
  // intentionally not on this allow-list, for the same reason as every other `*Snapshot` field.
  copyField(output, input, 'details', (details) =>
    normaliseArray(details, normaliseCatchDetail)
  )
  return output
}

/**
 * Normalises the client-owned landing section.
 *
 * `intention`'s allowed enum values, `notLandingDetails`'s shape, and the exact `retainedSpecies`
 * content rules are unresolved and deferred to Step 27 (canonical doc §4.7/§6) - this normaliser
 * preserves whatever the client supplied for them exactly, including the canonical doc's own flagged
 * possible inconsistency (e.g. `NOT_LANDING` with a non-empty `retainedSpecies`), rather than silently
 * repairing it. Reconciling `retainedSpecies` against the gear/species associations that actually exist
 * in the same Catch Record is explicitly out of scope for normalisation.
 *
 * @param {unknown} input
 * @returns {unknown}
 */
export function normaliseLanding(input) {
  if (input === undefined || input === null) {
    return input
  }

  if (typeof input !== 'object' || Array.isArray(input)) {
    return input
  }

  const output = {}
  // `intention`'s approved values are unresolved; copied as supplied, never inferred or defaulted.
  copyField(output, input, 'intention')
  copyField(output, input, 'retainedSpecies', (retainedSpecies) =>
    normaliseArray(retainedSpecies, normaliseRetainedSpecies)
  )
  // Shape unresolved (Step 27); copied as supplied, never corrected.
  copyField(output, input, 'notLandingDetails')
  return output
}
