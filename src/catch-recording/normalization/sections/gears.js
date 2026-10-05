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

function normaliseSpeciesAssociation(input) {
  if (input === undefined || input === null) {
    return input
  }

  if (typeof input !== 'object' || Array.isArray(input)) {
    return input
  }

  const output = {}
  // `associationId` is preserved if the caller already supplied one; Step 06 never generates one
  // (generation ownership is not assigned to normalisation by Step 05).
  copyField(output, input, 'associationId', normaliseTrimmedString)
  copyField(output, input, 'species', normaliseReferenceSelection)
  copyField(output, input, 'catchDetails', (catchDetails) =>
    normaliseArray(catchDetails, normaliseCatchDetail)
  )
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
    normaliseArray(speciesCaught, normaliseSpeciesAssociation)
  )
  return output
}

/**
 * Normalises the client-owned `gears` collection — the authoritative root for all gear-dependent data.
 * Characteristics, statistical area, and species (with their catch details) remain nested under the
 * gear association that contains them; no root-level statistical-area or species collection is ever
 * produced. The same authoritative species may appear, independently, under more than one gear
 * association — each occurrence is normalised on its own terms with no cross-gear deduplication.
 *
 * @param {unknown} input
 * @returns {unknown}
 */
export function normaliseGears(input) {
  return normaliseArray(input, normaliseGearAssociation)
}
