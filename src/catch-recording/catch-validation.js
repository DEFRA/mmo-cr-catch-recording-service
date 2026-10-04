import { combineValidationResults } from './catch-record-validation-result.js'
import {
  validateGearCollection,
  validatePairFishingSection,
  validateRetainedCatchSection,
  validateTripSection,
  validateVesselSection
} from './catch-record-structural-validators.js'
import { validateCatchRecordSection } from './catch-record-validation-sections.js'

// CatchValidation boundary (Step 02 — Catch Recording module boundaries; Step 07 — structural and
// section validation foundation).
//
// Represents the structural, section, cross-section validation responsibility described in
// design/design/catch-recording-service-design.md §6.5. Step 07 adds the two approved entry points
// (`validateSection`, `validateCompleteStructure`) — see
// design/architecture/catch-record-validation-foundation.md for the full specification. Neither entry
// point performs persistence, reference-data lookup, or final submission/lifecycle business rules; both
// assume their input has already been normalised by Step 06 (CatchNormalization) and never mutate it.
function validateSection(sectionName, value, context = {}) {
  return validateCatchRecordSection(sectionName, value, context)
}

function validateCompleteStructure(normalizedCatchRecord) {
  return combineValidationResults(
    validateVesselSection(normalizedCatchRecord?.vessel),
    validateTripSection(normalizedCatchRecord?.trip),
    validatePairFishingSection(normalizedCatchRecord?.pairFishing),
    validateGearCollection(normalizedCatchRecord?.gear ?? []),
    validateRetainedCatchSection(normalizedCatchRecord?.retainedCatch)
  )
}

export function createCatchValidation() {
  return Object.freeze({
    name: 'CatchValidation',
    dependencies: Object.freeze({}),
    validateSection,
    validateCompleteStructure
  })
}
