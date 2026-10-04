import {
  createValidationError,
  createValidationResult
} from './catch-record-validation-result.js'
import {
  validateGearEntry,
  validatePairFishingSection,
  validateRetainedCatchSection,
  validateSpeciesCaughtEntry,
  validateStatisticalAreaSection,
  validateTripSection,
  validateVesselSection
} from './catch-record-structural-validators.js'

// Approved Catch Recording validation-section catalogue (Step 07).
//
// Reused exactly from Step 06 (`catch-record-sections.js`'s seven identifiers) rather than redefined —
// see design/architecture/catch-record-validation-foundation.md §7 for the full reconciliation rationale.
// This is a fixed allow-list object: a section name that is not one of these seven keys is never looked
// up dynamically, evaluated, or used to construct a file/database path.
function requireGearAssociationId(context) {
  const gearAssociationId = context?.gearAssociationId

  if (
    typeof gearAssociationId !== 'string' ||
    gearAssociationId.trim() === ''
  ) {
    return createValidationResult([
      createValidationError(
        'REQUIRED_FIELD',
        'gearAssociationId',
        'This section requires an explicit gearAssociationId context.'
      )
    ])
  }

  return null
}

export const CATCH_RECORD_VALIDATION_SECTIONS = Object.freeze({
  vessel: Object.freeze({
    requiresGearContext: false,
    validate: (value) => validateVesselSection(value)
  }),
  trip: Object.freeze({
    requiresGearContext: false,
    validate: (value) => validateTripSection(value)
  }),
  'pair-fishing': Object.freeze({
    requiresGearContext: false,
    validate: (value) => validatePairFishingSection(value)
  }),
  gear: Object.freeze({
    requiresGearContext: false,
    validate: (value) => validateGearEntry(value, 'gear')
  }),
  'gear-statistical-area': Object.freeze({
    requiresGearContext: true,
    validate: (value, context) =>
      requireGearAssociationId(context) ??
      validateStatisticalAreaSection(value, 'statisticalArea')
  }),
  'gear-species': Object.freeze({
    requiresGearContext: true,
    validate: (value, context) =>
      requireGearAssociationId(context) ??
      validateSpeciesCaughtEntry(value, 'speciesCaught')
  }),
  'retained-catch': Object.freeze({
    requiresGearContext: false,
    validate: (value) => validateRetainedCatchSection(value)
  })
})

export function isCatchRecordValidationSection(name) {
  return Object.hasOwn(CATCH_RECORD_VALIDATION_SECTIONS, name)
}

export function validateCatchRecordSection(sectionName, value, context = {}) {
  if (!isCatchRecordValidationSection(sectionName)) {
    return createValidationResult([
      createValidationError(
        'UNKNOWN_FIELD',
        'section',
        'The requested Catch Recording section is not supported.'
      )
    ])
  }

  return CATCH_RECORD_VALIDATION_SECTIONS[sectionName].validate(value, context)
}
