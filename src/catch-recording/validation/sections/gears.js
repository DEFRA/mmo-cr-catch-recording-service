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
 * Validates a gear association's `gear` selection: a missing/empty `gear.id` is `REQUIRED`; a `gear`
 * that is present but not an object (a scalar or an array) is `INVALID_STRUCTURE`. Reference existence/
 * active-state is not this function's job — that is resolution's (`resolve-gears-section.js`).
 *
 * @param {object} gearAssociation
 * @param {number} gearIndex
 * @returns {ReadonlyArray<object>}
 */
function validateGearSelection(gearAssociation, gearIndex) {
  const { gear } = gearAssociation

  if (gear === undefined || gear === null) {
    return [
      issue(
        VALIDATION_CODES.REQUIRED,
        ['gears', gearIndex, 'gear', 'id'],
        'A gear id is required'
      )
    ]
  }

  if (typeof gear !== 'object' || Array.isArray(gear)) {
    return [
      issue(
        VALIDATION_CODES.INVALID_STRUCTURE,
        ['gears', gearIndex, 'gear'],
        'The gear selection must be an object'
      )
    ]
  }

  if (!isNonEmptyString(gear.id)) {
    return [
      issue(
        VALIDATION_CODES.REQUIRED,
        ['gears', gearIndex, 'gear', 'id'],
        'A gear id is required'
      )
    ]
  }

  return []
}

/**
 * Validates a gear association's optional `statisticalArea` selection (Step 24). The field is
 * genuinely optional and nullable: an **absent** key means "leave the gear's current statistical area
 * unchanged" and an explicit `null` means "clear the gear's statistical area" — neither is flagged here.
 * When a value is supplied it must be a plain object (`INVALID_STRUCTURE` otherwise) carrying a
 * required, non-empty `id` (`REQUIRED` otherwise). Reference existence/active-state is not this
 * function's job — that is resolution's (`resolve-gears-section.js`).
 *
 * @param {object} gearAssociation
 * @param {number} gearIndex
 * @returns {ReadonlyArray<object>}
 */
function validateStatisticalAreaSelection(gearAssociation, gearIndex) {
  if (!Object.hasOwn(gearAssociation, 'statisticalArea')) {
    return []
  }

  const { statisticalArea } = gearAssociation

  if (statisticalArea === null) {
    return []
  }

  if (typeof statisticalArea !== 'object' || Array.isArray(statisticalArea)) {
    return [
      issue(
        VALIDATION_CODES.INVALID_STRUCTURE,
        ['gears', gearIndex, 'statisticalArea'],
        'The statistical area selection must be an object'
      )
    ]
  }

  if (!isNonEmptyString(statisticalArea.id)) {
    return [
      issue(
        VALIDATION_CODES.REQUIRED,
        ['gears', gearIndex, 'statisticalArea', 'id'],
        'A statistical area id is required'
      )
    ]
  }

  return []
}

/**
 * Validates every supplied characteristic's `characteristicId` is a required, non-empty string. A
 * malformed (non-object) characteristic entry is ignored here, exactly like a malformed species-
 * association entry — structural shape beyond this is resolution's job.
 *
 * @param {object} gearAssociation
 * @param {number} gearIndex
 * @returns {ReadonlyArray<object>}
 */
function validateCharacteristics(gearAssociation, gearIndex) {
  if (!Array.isArray(gearAssociation.characteristics)) {
    return []
  }

  const issues = []

  gearAssociation.characteristics.forEach(
    (characteristic, characteristicIndex) => {
      if (typeof characteristic !== 'object' || characteristic === null) {
        return
      }

      if (!isNonEmptyString(characteristic.characteristicId)) {
        issues.push(
          issue(
            VALIDATION_CODES.REQUIRED,
            [
              'gears',
              gearIndex,
              'characteristics',
              characteristicIndex,
              'characteristicId'
            ],
            'A characteristic id is required'
          )
        )
      }
    }
  )

  return issues
}

/**
 * Validates one species-caught entry's shape and fields (Step 27 redesign): a required non-empty `id`
 * (the species' own authoritative identifier — no more synthetic relationship `associationId`, since
 * natural species identity is now the key), and, when supplied, nullable-finite-number weight fields
 * plus an approved `weightPrecision`. Reference existence/active-state is not this function's job — that
 * is resolution's (`resolve-species-caught.js`).
 *
 * @param {object} speciesEntry
 * @param {Array<string|number>} pathSegments
 * @returns {ReadonlyArray<object>}
 */
function validateSpeciesEntryFields(speciesEntry, pathSegments) {
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
 * Validates a gear association's `speciesCaught` collection shape and business rules (Step 27
 * redesign): `undefined`/`null` is tolerated (mirrors the structural validator's lenient container-shape
 * rule), an array is validated entry-by-entry, and anything else is `INVALID_STRUCTURE`. Within the
 * array: a required `id` per entry, approved weight-field/`weightPrecision` shapes, and a duplicate
 * authoritative `id` beneath the same gear is rejected as `DUPLICATE_RELATIONSHIP` (the same species
 * selected twice under one gear is one relationship too many — there is no longer a synthetic
 * relationship `associationId` to disambiguate them; the same species under a *different* gear is
 * explicitly valid and never flagged here).
 *
 * @param {object} gearAssociation
 * @param {number} gearIndex
 * @returns {ReadonlyArray<object>}
 */
function validateSpeciesCaught(gearAssociation, gearIndex) {
  const { speciesCaught } = gearAssociation

  if (speciesCaught === undefined || speciesCaught === null) {
    return []
  }

  if (!Array.isArray(speciesCaught)) {
    return [
      issue(
        VALIDATION_CODES.INVALID_STRUCTURE,
        ['gears', gearIndex, 'speciesCaught'],
        'The species-caught collection must be an array'
      )
    ]
  }

  const issues = []
  const seenSpeciesIds = new Set()

  speciesCaught.forEach((speciesEntry, speciesIndex) => {
    if (typeof speciesEntry !== 'object' || speciesEntry === null) {
      return
    }

    const pathSegments = ['gears', gearIndex, 'speciesCaught', speciesIndex]
    issues.push(...validateSpeciesEntryFields(speciesEntry, pathSegments))

    const speciesId = speciesEntry.id
    if (isNonEmptyString(speciesId)) {
      if (seenSpeciesIds.has(speciesId)) {
        issues.push(
          issue(
            VALIDATION_CODES.DUPLICATE_RELATIONSHIP,
            [...pathSegments, 'id'],
            'This species is already selected under this gear'
          )
        )
      }
      seenSpeciesIds.add(speciesId)
    }
  })

  return issues
}

/**
 * Detects duplicate gear-association IDs within the same `gears` collection (the only stable
 * relationship identity remaining at gear level — species-level identity is now the species' own
 * natural `id`, since Step 27's redesign removed the synthetic gear-to-species relationship
 * `associationId`).
 *
 * Also enforces the Step 23 business rules: a non-empty `gear.id` is required per gear association, and
 * a non-empty `characteristicId` is required per supplied characteristic; the Step 24 rule: a supplied
 * `statisticalArea` must be a plain object with a non-empty `id` (an absent key is "leave unchanged", an
 * explicit `null` is "clear the area" — neither is an error); and the Step 27 rules: a non-empty `id` is
 * required per supplied species-caught entry, approved weight-field/`weightPrecision` shapes, and the
 * same authoritative species cannot be selected twice beneath the same gear. These are deliberately
 * structural/presence checks only — reference existence and active-state belong to the save-time
 * snapshot-resolution boundary (`resolve-gears-section.js`), never to this framework-neutral validator.
 *
 * @param {unknown} gears
 * @returns {{ valid: boolean, issues: ReadonlyArray<object> }}
 */
export function validateGears(gears) {
  if (!Array.isArray(gears)) {
    return createValidResult()
  }

  const issues = []
  const seenGearAssociationIds = new Set()

  gears.forEach((gearAssociation, gearIndex) => {
    if (typeof gearAssociation !== 'object' || gearAssociation === null) {
      return
    }

    const { associationId } = gearAssociation
    if (typeof associationId === 'string' && associationId.trim().length > 0) {
      if (seenGearAssociationIds.has(associationId)) {
        issues.push(
          issue(
            VALIDATION_CODES.DUPLICATE_RELATIONSHIP,
            ['gears', gearIndex, 'associationId'],
            'Duplicate gear association'
          )
        )
      }
      seenGearAssociationIds.add(associationId)
    }

    issues.push(...validateGearSelection(gearAssociation, gearIndex))
    issues.push(...validateCharacteristics(gearAssociation, gearIndex))
    issues.push(...validateStatisticalAreaSelection(gearAssociation, gearIndex))
    issues.push(...validateSpeciesCaught(gearAssociation, gearIndex))
  })

  return issues.length === 0 ? createValidResult() : createInvalidResult(issues)
}
