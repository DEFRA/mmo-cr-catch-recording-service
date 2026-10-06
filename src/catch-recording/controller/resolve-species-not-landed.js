import { ApplicationError } from '#/common/helpers/errors/application-error.js'
import { resolveSpecies } from '#/catch-recording/reference-data/reference-resolvers.js'

const WEIGHT_FIELDS = Object.freeze([
  'weightAboveMinimumKg',
  'weightBelowMinimumKg',
  'weightLegallyDiscardedKg'
])

/**
 * Step 27 redesign's save-time snapshot-resolution boundary for the root-level `speciesNotLanded`
 * section. Resolves each incoming species selection fresh from the Reference Data Service, exactly
 * mirroring the gear-level `resolveSpeciesCaught` precedent — **never** trusting a client-supplied
 * snapshot. Only the stable `id` and the supplied weight fields/`weightPrecision` ever survive into the
 * output; every client-supplied snapshot field is discarded and replaced by the approved slim
 * `faoCodeSnapshot`/`nameSnapshot` pair.
 *
 * A species that cannot be resolved (missing id, malformed id, not found, or inactive) contributes its
 * issue(s) to a single aggregated list; if any issue was collected across the whole collection, one
 * `BUSINESS_VALIDATION_FAILURE`/`SECTION_VALIDATION_FAILED` `ApplicationError` is thrown with
 * `details: issues`. Any other Reference Data Service dependency failure (timeout, unavailable,
 * malformed upstream response) propagates unchanged — it is never folded into a validation outcome.
 *
 * Never mutates `speciesNotLanded` or any of its nested objects.
 *
 * @param {unknown} speciesNotLanded the already-normalised, already-validated `speciesNotLanded`
 *   collection (a non-array value is treated defensively as an empty collection)
 * @param {object} referenceDataClient Step 15 Reference Data Service client (`getSpeciesById`, ...)
 * @param {string} [correlationId]
 * @returns {Promise<Array<object>>} ordered exactly as supplied
 * @throws {ApplicationError} `BUSINESS_VALIDATION_FAILURE` when any species cannot be resolved; any
 *   Reference Data Service dependency failure is rethrown unchanged
 */
export async function resolveSpeciesNotLandedSection(
  speciesNotLanded,
  referenceDataClient,
  correlationId
) {
  const sourceEntries = Array.isArray(speciesNotLanded) ? speciesNotLanded : []
  const issues = []
  const resolved = []

  for (const [index, speciesEntry] of sourceEntries.entries()) {
    const resolvedEntry = await resolveOneSpeciesEntry({
      speciesEntry,
      index,
      referenceDataClient,
      correlationId,
      issues
    })

    if (resolvedEntry) {
      resolved.push(resolvedEntry)
    }
  }

  if (issues.length > 0) {
    throw sectionValidationError(issues)
  }

  return resolved
}

async function resolveOneSpeciesEntry({
  speciesEntry,
  index,
  referenceDataClient,
  correlationId,
  issues
}) {
  const { result, snapshot } = await resolveSpecies({
    id: speciesEntry?.id,
    path: ['speciesNotLanded', index],
    client: referenceDataClient,
    correlationId
  })

  if (!result.valid) {
    issues.push(...result.issues)
    return null
  }

  return buildResolvedSpeciesEntry(speciesEntry, snapshot)
}

function buildResolvedSpeciesEntry(speciesEntry, snapshot) {
  const resolvedEntry = { id: speciesEntry.id, ...snapshot }

  for (const field of WEIGHT_FIELDS) {
    if (Object.hasOwn(speciesEntry, field)) {
      resolvedEntry[field] = speciesEntry[field]
    }
  }

  if (Object.hasOwn(speciesEntry, 'weightPrecision')) {
    resolvedEntry.weightPrecision = speciesEntry.weightPrecision
  }

  return resolvedEntry
}

function sectionValidationError(issues) {
  return new ApplicationError({
    category: 'BUSINESS_VALIDATION_FAILURE',
    code: 'SECTION_VALIDATION_FAILED',
    message: 'The supplied section data is invalid.',
    details: issues
  })
}
