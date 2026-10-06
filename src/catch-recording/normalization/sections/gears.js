import { normaliseTrimmedString } from '../primitives.js'
import {
  copyField,
  normaliseArray,
  normaliseReferenceSelection
} from '../object-helpers.js'

function normaliseCharacteristic(input) {
  if (input === undefined || input === null) {
    return input
  }

  if (typeof input !== 'object' || Array.isArray(input)) {
    return input
  }

  const output = {}
  copyField(output, input, 'characteristicId', normaliseTrimmedString)
  // `value` is approved as number | string | boolean with the exact type still deferred (canonical
  // doc §4.5/§6) - copied as supplied, never coerced.
  copyField(output, input, 'value')
  copyField(output, input, 'unitSnapshot', normaliseTrimmedString)
  return output
}

/**
 * Normalises one species-caught entry (Step 27 redesign): a flat shape keyed directly by the species'
 * own authoritative `id` (no synthetic relationship `associationId` - the service-owner decision removed
 * it, since a species can only appear once per gear). The three weight fields and `weightPrecision` are
 * copied through exactly as supplied - weight values are approved as numbers (or `null`), never coerced
 * or rounded, and `weightPrecision`'s two approved values are validated, not inferred, by Step 07.
 * Client-supplied snapshot fields (`name`, `faoCode`, `scientificName`, `commonNames`, `localNames`,
 * `isActive` - the full Reference Data Service record a client might echo back) are never copied: the
 * approved shape only ever persists the slim `id` plus server-resolved `faoCodeSnapshot`/`nameSnapshot`,
 * exactly like every other reference selection in this service.
 *
 * @param {unknown} input
 * @returns {unknown}
 */
export function normaliseSpeciesEntry(input) {
  if (input === undefined || input === null) {
    return input
  }

  if (typeof input !== 'object' || Array.isArray(input)) {
    return input
  }

  const output = {}
  copyField(output, input, 'id', normaliseTrimmedString)
  copyField(output, input, 'weightAboveMinimumKg')
  copyField(output, input, 'weightBelowMinimumKg')
  copyField(output, input, 'weightLegallyDiscardedKg')
  copyField(output, input, 'weightPrecision', normaliseTrimmedString)
  return output
}

function normaliseGearAssociation(input) {
  if (input === undefined || input === null) {
    return input
  }

  if (typeof input !== 'object' || Array.isArray(input)) {
    return input
  }

  const output = {}
  copyField(output, input, 'associationId', normaliseTrimmedString)
  copyField(output, input, 'gear', normaliseReferenceSelection)
  copyField(output, input, 'characteristics', (characteristics) =>
    normaliseArray(characteristics, normaliseCharacteristic)
  )
  copyField(output, input, 'statisticalArea', normaliseReferenceSelection)
  copyField(output, input, 'speciesCaught', (speciesCaught) =>
    normaliseArray(speciesCaught, normaliseSpeciesEntry)
  )
  return output
}

/**
 * Normalises the client-owned `gears` collection — the authoritative root for all gear-dependent data.
 * Characteristics, statistical area, and landed species remain nested under the gear association that
 * contains them; no root-level statistical-area or landed-species collection is ever produced. The same
 * authoritative species may appear, independently, under more than one gear association — each
 * occurrence is normalised on its own terms with no cross-gear deduplication.
 *
 * @param {unknown} input
 * @returns {unknown}
 */
export function normaliseGears(input) {
  return normaliseArray(input, normaliseGearAssociation)
}
