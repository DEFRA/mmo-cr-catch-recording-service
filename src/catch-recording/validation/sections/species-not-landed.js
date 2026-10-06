import { VALIDATION_CODES } from '../validation-codes.js'
import {
  createInvalidResult,
  createValidResult,
  formatPath
} from '../validation-result.js'

function issue(code, pathSegments, message) {
  return { code, path: formatPath(pathSegments), message }
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

// The two approved `weightPrecision` values (Step 27 redesign - service-owner decision). No other
// value is approved; do not infer a third precision level.
const WEIGHT_PRECISION_VALUES = ['wholeNumber', 'oneDecimalPlace']

/**
 * Validates one `speciesNotLanded` entry's shape and fields: a required non-empty `id` (the species'
 * own authoritative identifier), and, when supplied, nullable-finite-number weight fields plus an
 * approved `weightPrecision`. Identical entry shape to a gear's `speciesCaught` entry
 * (`sections/gears.js`) - the only difference is that this collection lives at the Catch Record root,
 * is trip-level (not tied to any one gear), and is independent of any gear's `speciesCaught` selections.
 * Reference existence/active-state is not this function's job - that belongs to the save-time
 * snapshot-resolution boundary.
 *
 * @param {object} speciesEntry
 * @param {number} index
 * @returns {ReadonlyArray<object>}
 */
function validateSpeciesNotLandedEntryFields(speciesEntry, index) {
  const pathSegments = ['speciesNotLanded', index]
  const issues = []

  if (!isNonEmptyString(speciesEntry.id)) {
    issues.push(
      issue(
        VALIDATION_CODES.REQUIRED,
        [...pathSegments, 'id'],
        'A species id is required'
      )
    )
  }

  for (const field of [
    'weightAboveMinimumKg',
    'weightBelowMinimumKg',
    'weightLegallyDiscardedKg'
  ]) {
    if (!Object.hasOwn(speciesEntry, field)) {
      continue
    }

    const value = speciesEntry[field]
    if (
      value !== null &&
      !(typeof value === 'number' && Number.isFinite(value))
    ) {
      issues.push(
        issue(
          VALIDATION_CODES.INVALID_STRUCTURE,
          [...pathSegments, field],
          'A weight must be a number or null'
        )
      )
    }
  }

  if (
    Object.hasOwn(speciesEntry, 'weightPrecision') &&
    speciesEntry.weightPrecision !== null &&
    !WEIGHT_PRECISION_VALUES.includes(speciesEntry.weightPrecision)
  ) {
    issues.push(
      issue(
        VALIDATION_CODES.UNSUPPORTED_VALUE,
        [...pathSegments, 'weightPrecision'],
        'Unsupported weight precision'
      )
    )
  }

  return issues
}

/**
 * Validates the root-level `speciesNotLanded` collection (Step 27 redesign): `undefined`/`null` is
 * tolerated, an array is validated entry-by-entry, and anything else is `INVALID_STRUCTURE`. Detects a
 * duplicate authoritative species `id` within the collection (one trip-level entry per species, since
 * there is no gear/relationship context to disambiguate a repeat). `speciesNotLanded` is explicitly
 * independent of every gear's `speciesCaught` - the same species may appear in both collections (caught
 * partly landed, partly not), and no cross-reference check is applied between them.
 *
 * @param {unknown} speciesNotLanded
 * @returns {{ valid: boolean, issues: ReadonlyArray<object> }}
 */
export function validateSpeciesNotLanded(speciesNotLanded) {
  if (!Array.isArray(speciesNotLanded)) {
    return createValidResult()
  }

  const issues = []
  const seenSpeciesIds = new Set()

  speciesNotLanded.forEach((speciesEntry, index) => {
    if (typeof speciesEntry !== 'object' || speciesEntry === null) {
      return
    }

    issues.push(...validateSpeciesNotLandedEntryFields(speciesEntry, index))

    const speciesId = speciesEntry.id
    if (isNonEmptyString(speciesId)) {
      if (seenSpeciesIds.has(speciesId)) {
        issues.push(
          issue(
            VALIDATION_CODES.DUPLICATE_RELATIONSHIP,
            ['speciesNotLanded', index, 'id'],
            'This species is already listed as not landed'
          )
        )
      }
      seenSpeciesIds.add(speciesId)
    }
  })

  return issues.length === 0 ? createValidResult() : createInvalidResult(issues)
}
