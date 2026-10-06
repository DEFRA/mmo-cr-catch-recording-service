import { normaliseArray } from '../object-helpers.js'
import { normaliseSpeciesEntry } from './gears.js'

/**
 * Normalises the client-owned, root-level `speciesNotLanded` collection (Step 27 redesign): a single,
 * trip-level list of species caught but not landed this trip, independent of any gear's `speciesCaught`
 * selections. Reuses the identical per-entry normaliser (`normaliseSpeciesEntry`) used for a gear's
 * `speciesCaught`, since both collections share the exact same entry shape (`id` + weight fields +
 * `weightPrecision`).
 *
 * @param {unknown} input
 * @returns {unknown}
 */
export function normaliseSpeciesNotLanded(input) {
  return normaliseArray(input, normaliseSpeciesEntry)
}
