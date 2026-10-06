import { resolveSpecies } from '#/catch-recording/reference-data/reference-resolvers.js'

const WEIGHT_FIELDS = Object.freeze([
  'weightAboveMinimumKg',
  'weightBelowMinimumKg',
  'weightLegallyDiscardedKg'
])

/**
 * Step 27 redesign's save-time snapshot-resolution boundary for one gear's `speciesCaught` collection.
 * Resolves each incoming species selection fresh from the Reference Data Service, exactly mirroring the
 * `resolveGearsSection`/`resolveCharacteristics` precedent — **never** trusting a client-supplied
 * snapshot. Any client-supplied snapshot field (`name`, `faoCode`, `scientificName`, `commonNames`,
 * `localNames`, `isActive` — the full Reference Data Service record a client might echo back) is
 * discarded and replaced by the approved slim `faoCodeSnapshot`/`nameSnapshot` pair; only the stable
 * `id` and the supplied weight fields/`weightPrecision` ever survive into the output. Weight values are
 * copied through exactly as supplied — never coerced, rounded, or converted (approved Step 27 decision,
 * mirroring the established gear-characteristic `value` precedent).
 *
 * A species that cannot be resolved (missing id, malformed id, not found, or inactive) has its issue(s)
 * appended to the caller-supplied `issues` array (the same aggregation list used across the whole
 * `gears` section resolution) rather than being thrown here directly — the caller decides when to stop
 * and throw the single aggregated `SECTION_VALIDATION_FAILED` error. Any other Reference Data Service
 * dependency failure (timeout, unavailable, malformed upstream response) propagates unchanged — it is
 * never folded into a validation outcome.
 *
 * Never mutates `speciesCaught` or any of its nested objects.
 *
 * @param {Object} input
 * @param {unknown} input.speciesCaught the already-normalised, already-validated `speciesCaught`
 *   collection for one gear association (a non-array, non-nullish value is treated defensively as an
 *   empty collection so this module never crashes when exercised in isolation — `validateGears` rejects
 *   a malformed collection before this is ever reached in the real pipeline)
 * @param {number} input.gearIndex the owning gear's index, for canonical path construction
 * @param {object} input.referenceDataClient Step 15 Reference Data Service client (`getSpeciesById`, ...)
 * @param {string} [input.correlationId]
 * @param {Array<object>} input.issues the shared, caller-owned aggregated-issues list
 * @returns {Promise<Array<object>>} ordered exactly as supplied; each entry is `{ id, faoCodeSnapshot,
 *   nameSnapshot, weightAboveMinimumKg?, weightBelowMinimumKg?, weightLegallyDiscardedKg?,
 *   weightPrecision? }`
 */
export async function resolveSpeciesCaught({
  speciesCaught,
  gearIndex,
  referenceDataClient,
  correlationId,
  issues
}) {
  const sourceEntries = Array.isArray(speciesCaught) ? speciesCaught : []
  const resolved = []

  for (const [speciesIndex, speciesEntry] of sourceEntries.entries()) {
    const resolvedEntry = await resolveOneSpeciesEntry({
      speciesEntry,
      gearIndex,
      speciesIndex,
      referenceDataClient,
      correlationId,
      issues
    })

    if (resolvedEntry) {
      resolved.push(resolvedEntry)
    }
  }

  return resolved
}

async function resolveOneSpeciesEntry({
  speciesEntry,
  gearIndex,
  speciesIndex,
  referenceDataClient,
  correlationId,
  issues
}) {
  const { result, snapshot } = await resolveSpecies({
    id: speciesEntry?.id,
    path: ['gears', gearIndex, 'speciesCaught', speciesIndex],
    client: referenceDataClient,
    correlationId
  })

  if (!result.valid) {
    issues.push(...result.issues)
    return null
  }

  return buildResolvedSpeciesEntry(speciesEntry, snapshot)
}

/**
 * Builds the resolved output entry: the authoritative `id` plus the freshly resolved snapshot, then
 * whichever approved weight fields/`weightPrecision` the caller actually supplied (preserving the
 * "absent key is absent in the output" distinction the rest of this service's normalisation already
 * relies on).
 *
 * @param {object} speciesEntry the already-normalised incoming entry
 * @param {object} snapshot `{ faoCodeSnapshot, nameSnapshot }`, freshly resolved
 * @returns {object}
 */
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
