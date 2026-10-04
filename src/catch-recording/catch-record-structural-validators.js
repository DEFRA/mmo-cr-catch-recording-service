import {
  findDuplicateKeys,
  validateBoolean,
  validateCalendarDate,
  validateCollectionLength,
  validateEnum,
  validateIdentifier,
  validateNumber,
  validateOptionalString,
  validateRequiredString
} from './catch-record-primitive-validators.js'
import {
  createValidationError,
  createValidationResult,
  indexPath,
  joinPath
} from './catch-record-validation-result.js'

// CatchValidation structural and section validators (Step 07).
//
// Every function assumes Step 06 has already normalised its input (see
// design/architecture/catch-record-validation-foundation.md §9 for the composition boundary) and never
// mutates it. Each returns a ValidationResult (`{ isValid, errors }`), never throws for expected invalid
// input, and short-circuits on a parent type mismatch rather than cascading meaningless child errors.
function isPlainObjectOrNull(value) {
  return value === null || (typeof value === 'object' && !Array.isArray(value))
}

function typeMismatchResult(path) {
  return createValidationResult([
    createValidationError(
      'INVALID_TYPE',
      path,
      'An object value is required.',
      {
        expectedType: 'object'
      }
    )
  ])
}

export function validateVesselSection(vessel, path = 'vessel') {
  if (!isPlainObjectOrNull(vessel)) {
    return typeMismatchResult(path)
  }

  if (vessel === null) {
    return createValidationResult()
  }

  const errors = [
    ...validateIdentifier(vessel.id, joinPath(path, 'id')),
    ...validateOptionalString(
      vessel.nameSnapshot,
      joinPath(path, 'nameSnapshot')
    ),
    ...validateOptionalString(
      vessel.registrationSnapshot,
      joinPath(path, 'registrationSnapshot')
    ),
    ...validateOptionalString(
      vessel.externalMarkSnapshot,
      joinPath(path, 'externalMarkSnapshot')
    ),
    ...validateNumber(
      vessel.lengthOverallMetres,
      joinPath(path, 'lengthOverallMetres'),
      { positive: true }
    )
  ]

  return createValidationResult(errors)
}

export function validatePortSection(port, path) {
  if (!isPlainObjectOrNull(port)) {
    return typeMismatchResult(path)
  }

  if (port === null) {
    return createValidationResult()
  }

  const errors = [
    ...validateIdentifier(port.id, joinPath(path, 'id')),
    ...validateOptionalString(
      port.codeSnapshot,
      joinPath(path, 'codeSnapshot')
    ),
    ...validateOptionalString(port.nameSnapshot, joinPath(path, 'nameSnapshot'))
  ]

  return createValidationResult(errors)
}

export function validateTripSection(trip, path = 'trip') {
  if (!isPlainObjectOrNull(trip)) {
    return typeMismatchResult(path)
  }

  if (trip === null) {
    return createValidationResult()
  }

  const errors = [
    ...validateBoolean(
      trip.startedAndFinishedToday,
      joinPath(path, 'startedAndFinishedToday')
    )
  ]

  // Conditional rule (approved example): explicit trip dates are required when the trip was not started
  // and finished today.
  const datesRequired = trip.startedAndFinishedToday === false

  if (
    datesRequired &&
    (trip.dateStarted === null || trip.dateStarted === undefined)
  ) {
    errors.push(
      createValidationError(
        'CONDITIONAL_FIELD_REQUIRED',
        joinPath(path, 'dateStarted'),
        'A start date is required when the trip was not started and finished today.'
      )
    )
  } else {
    errors.push(
      ...validateCalendarDate(trip.dateStarted, joinPath(path, 'dateStarted'))
    )
  }

  if (
    datesRequired &&
    (trip.dateEnded === null || trip.dateEnded === undefined)
  ) {
    errors.push(
      createValidationError(
        'CONDITIONAL_FIELD_REQUIRED',
        joinPath(path, 'dateEnded'),
        'An end date is required when the trip was not started and finished today.'
      )
    )
  } else {
    errors.push(
      ...validateCalendarDate(trip.dateEnded, joinPath(path, 'dateEnded'))
    )
  }

  errors.push(
    ...validatePortSection(trip.departurePort, joinPath(path, 'departurePort'))
      .errors,
    ...validatePortSection(trip.returnPort, joinPath(path, 'returnPort')).errors
  )

  return createValidationResult(errors)
}

// Extracted from validatePairFishingSection to keep that function's cyclomatic and cognitive complexity
// within the approved limits: the "enabled" and "disabled" conditional-detail rules are independent,
// mutually exclusive branches, so each is clearer and simpler to verify as its own small function.
function validatePairFishingEnabledDetails(pairFishing, nameField, rssField) {
  const errors = []

  if (!pairFishing.pairSkipperFullName) {
    errors.push(
      createValidationError(
        'CONDITIONAL_FIELD_REQUIRED',
        nameField,
        'A pair skipper name is required when pair fishing is enabled.'
      )
    )
  } else {
    errors.push(
      ...validateRequiredString(pairFishing.pairSkipperFullName, nameField)
    )
  }

  if (!pairFishing.pairVesselRssNumber) {
    errors.push(
      createValidationError(
        'CONDITIONAL_FIELD_REQUIRED',
        rssField,
        'A pair vessel RSS number is required when pair fishing is enabled.'
      )
    )
  } else {
    errors.push(
      ...validateIdentifier(pairFishing.pairVesselRssNumber, rssField)
    )
  }

  return errors
}

function validatePairFishingDisabledDetails(pairFishing, nameField, rssField) {
  const errors = []

  if (
    pairFishing.pairSkipperFullName !== null &&
    pairFishing.pairSkipperFullName !== undefined
  ) {
    errors.push(
      createValidationError(
        'CONDITIONAL_FIELD_PROHIBITED',
        nameField,
        'A pair skipper name must not be supplied when pair fishing is disabled.'
      )
    )
  }

  if (
    pairFishing.pairVesselRssNumber !== null &&
    pairFishing.pairVesselRssNumber !== undefined
  ) {
    errors.push(
      createValidationError(
        'CONDITIONAL_FIELD_PROHIBITED',
        rssField,
        'A pair vessel RSS number must not be supplied when pair fishing is disabled.'
      )
    )
  }

  return errors
}

export function validatePairFishingSection(pairFishing, path = 'pairFishing') {
  if (!isPlainObjectOrNull(pairFishing)) {
    return typeMismatchResult(path)
  }

  if (pairFishing === null) {
    return createValidationResult()
  }

  const errors = [
    ...validateBoolean(pairFishing.enabled, joinPath(path, 'enabled'))
  ]
  const nameField = joinPath(path, 'pairSkipperFullName')
  const rssField = joinPath(path, 'pairVesselRssNumber')

  if (pairFishing.enabled === true) {
    errors.push(
      ...validatePairFishingEnabledDetails(pairFishing, nameField, rssField)
    )
  } else if (pairFishing.enabled === false) {
    errors.push(
      ...validatePairFishingDisabledDetails(pairFishing, nameField, rssField)
    )
  } else {
    // enabled is neither true nor false (already reported as INVALID_BOOLEAN above, or left null/
    // undefined for an unanswered section) — no conditional detail rule applies.
  }

  return createValidationResult(errors)
}

export function validateGearCharacteristicEntry(characteristic, path) {
  if (!isPlainObjectOrNull(characteristic) || characteristic === null) {
    return typeMismatchResult(path)
  }

  const errors = [
    ...validateIdentifier(
      characteristic.characteristicId,
      joinPath(path, 'characteristicId')
    ),
    ...validateOptionalString(
      characteristic.nameSnapshot,
      joinPath(path, 'nameSnapshot')
    ),
    ...validateOptionalString(characteristic.value, joinPath(path, 'value'))
  ]

  return createValidationResult(errors)
}

export function validateStatisticalAreaSection(statisticalArea, path) {
  if (!isPlainObjectOrNull(statisticalArea)) {
    return typeMismatchResult(path)
  }

  if (statisticalArea === null) {
    return createValidationResult()
  }

  const errors = [
    ...validateIdentifier(statisticalArea.id, joinPath(path, 'id')),
    ...validateOptionalString(statisticalArea.code, joinPath(path, 'code')),
    ...validateOptionalString(
      statisticalArea.nameSnapshot,
      joinPath(path, 'nameSnapshot')
    )
  ]

  return createValidationResult(errors)
}

export function validateSpeciesAttributeEntry(attribute, path) {
  if (!isPlainObjectOrNull(attribute) || attribute === null) {
    return typeMismatchResult(path)
  }

  const errors = [
    ...validateIdentifier(attribute.attributeId, joinPath(path, 'attributeId')),
    ...validateOptionalString(
      attribute.nameSnapshot,
      joinPath(path, 'nameSnapshot')
    ),
    ...validateOptionalString(attribute.value, joinPath(path, 'value'))
  ]

  return createValidationResult(errors)
}

export function validateSpeciesCaughtEntry(species, path) {
  if (!isPlainObjectOrNull(species) || species === null) {
    return typeMismatchResult(path)
  }

  const errors = [
    ...validateIdentifier(species.speciesId, joinPath(path, 'speciesId')),
    ...validateOptionalString(
      species.faoCodeSnapshot,
      joinPath(path, 'faoCodeSnapshot')
    ),
    ...validateOptionalString(
      species.nameSnapshot,
      joinPath(path, 'nameSnapshot')
    )
  ]

  const attributes = Array.isArray(species.attributes) ? species.attributes : []
  const attributesPath = joinPath(path, 'attributes')

  attributes.forEach((attribute, index) => {
    errors.push(
      ...validateSpeciesAttributeEntry(
        attribute,
        indexPath(attributesPath, index)
      ).errors
    )
  })

  const duplicateAttributeIds = findDuplicateKeys(
    attributes,
    (a) => a?.attributeId
  )
  for (const duplicateId of duplicateAttributeIds) {
    errors.push(
      createValidationError(
        'DUPLICATE_VALUE',
        attributesPath,
        'A duplicate attribute identifier was found within this species.',
        { duplicateValue: duplicateId }
      )
    )
  }

  return createValidationResult(errors)
}

export function validateGearEntry(gear, path) {
  if (!isPlainObjectOrNull(gear) || gear === null) {
    return typeMismatchResult(path)
  }

  const errors = [
    ...validateIdentifier(gear.gearId, joinPath(path, 'gearId')),
    ...validateIdentifier(gear.associationId, joinPath(path, 'associationId')),
    ...validateOptionalString(
      gear.codeSnapshot,
      joinPath(path, 'codeSnapshot')
    ),
    ...validateOptionalString(gear.nameSnapshot, joinPath(path, 'nameSnapshot'))
  ]

  const characteristics = Array.isArray(gear.characteristics)
    ? gear.characteristics
    : []
  const characteristicsPath = joinPath(path, 'characteristics')

  characteristics.forEach((characteristic, index) => {
    errors.push(
      ...validateGearCharacteristicEntry(
        characteristic,
        indexPath(characteristicsPath, index)
      ).errors
    )
  })

  const duplicateCharacteristicIds = findDuplicateKeys(
    characteristics,
    (c) => c?.characteristicId
  )
  for (const duplicateId of duplicateCharacteristicIds) {
    errors.push(
      createValidationError(
        'DUPLICATE_VALUE',
        characteristicsPath,
        'A duplicate characteristic identifier was found within this gear.',
        { duplicateValue: duplicateId }
      )
    )
  }

  errors.push(
    ...validateStatisticalAreaSection(
      gear.statisticalArea,
      joinPath(path, 'statisticalArea')
    ).errors
  )

  const speciesCaught = Array.isArray(gear.speciesCaught)
    ? gear.speciesCaught
    : []
  const speciesCaughtPath = joinPath(path, 'speciesCaught')

  speciesCaught.forEach((species, index) => {
    errors.push(
      ...validateSpeciesCaughtEntry(
        species,
        indexPath(speciesCaughtPath, index)
      ).errors
    )
  })

  // Duplicate species are only checked WITHIN this one gear's own speciesCaught collection — the same
  // species under a different gear is a structurally independent relationship and is never compared here.
  const duplicateSpeciesIds = findDuplicateKeys(
    speciesCaught,
    (s) => s?.speciesId
  )
  for (const duplicateId of duplicateSpeciesIds) {
    errors.push(
      createValidationError(
        'DUPLICATE_VALUE',
        speciesCaughtPath,
        'A duplicate species identifier was found within this gear.',
        { duplicateValue: duplicateId }
      )
    )
  }

  return createValidationResult(errors)
}

export function validateGearCollection(gearArray, path = 'gear', { max } = {}) {
  if (!Array.isArray(gearArray)) {
    return typeMismatchResult(path)
  }

  const errors = [...validateCollectionLength(gearArray, path, { max })]

  gearArray.forEach((gear, index) => {
    errors.push(...validateGearEntry(gear, indexPath(path, index)).errors)
  })

  // Repeated gearId across different gear entries is intentionally NOT a duplicate (see the Step 07 plan
  // §25): the canonical design's own gearId/associationId separation exists so the same gear type can be
  // selected more than once. Only a repeated associationId — two entries claiming the same occurrence
  // identity — is structurally invalid.
  const duplicateAssociationIds = findDuplicateKeys(
    gearArray,
    (g) => g?.associationId
  )
  for (const duplicateId of duplicateAssociationIds) {
    errors.push(
      createValidationError(
        'DUPLICATE_VALUE',
        path,
        'A duplicate gear association identifier was found in this catch record.',
        { duplicateValue: duplicateId }
      )
    )
  }

  return createValidationResult(errors)
}

export function validateRetainedCatchSection(
  retainedCatch,
  path = 'retainedCatch'
) {
  if (!isPlainObjectOrNull(retainedCatch)) {
    return typeMismatchResult(path)
  }

  if (retainedCatch === null) {
    return createValidationResult()
  }

  const errors = [
    ...validateEnum(retainedCatch.answer, joinPath(path, 'answer'), [
      'YES',
      'NO'
    ])
  ]

  if (!Array.isArray(retainedCatch.species)) {
    errors.push(
      createValidationError(
        'INVALID_TYPE',
        joinPath(path, 'species'),
        'An array value is required.',
        { expectedType: 'array' }
      )
    )
  }

  // retainedCatch.species entries have no approved per-entry field shape (deferred to Phase 8; see
  // design/architecture/canonical-catch-record-object-v1.md §10) — no field-level rule is applied here,
  // and no conditional rule linking `answer` to `species` presence is implemented, for the same reason.

  return createValidationResult(errors)
}
