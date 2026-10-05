import { combineResults } from './validation-result.js'
import { validateStructure } from './structural.js'
import { validateGears } from './sections/gears.js'
import { validatePairFishing } from './sections/pair-fishing.js'
import { validateLanding } from './sections/landing.js'

/**
 * Composes the approved reusable validators into one complete-validation result, in a fixed,
 * deterministic order: structure, then gears (duplicates), then pair-fishing (conditional), then
 * landing (cross-reference). This is the reusable foundation Step 32 will extend with submission-
 * readiness rules and dependencies not yet implemented — it does not itself decide submission
 * readiness, lifecycle eligibility, or reference-data validity.
 *
 * @param {unknown} catchRecord
 * @returns {{ valid: boolean, issues: ReadonlyArray<object> }}
 */
export function validateCatchRecord(catchRecord) {
  const structuralResult = validateStructure(catchRecord)

  // A malformed root makes every nested path meaningless to evaluate further; return the structural
  // failure alone rather than risking an unsafe nested access.
  if (
    !structuralResult.valid &&
    structuralResult.issues.some((issue) => issue.path === '')
  ) {
    return structuralResult
  }

  // Past this point, validateStructure has already confirmed catchRecord is a plain object.
  const { gears, landing, pairFishing } = catchRecord

  return combineResults(
    structuralResult,
    validateGears(gears),
    validatePairFishing(pairFishing),
    validateLanding(landing, gears)
  )
}
