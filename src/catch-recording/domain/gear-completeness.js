/**
 * Step 26: reusable, pure, framework-neutral per-gear completeness and multi-gear domain-progress
 * evaluation. Operates entirely on the already-persisted canonical `gears` collection — never mutates
 * it, never calls the Reference Data Service or any other dependency, and never depends on Hapi, Boom,
 * or MongoDB. This keeps completeness a deterministic function of the canonical record alone: the same
 * persisted `gears` always yields the same result, independent of any external system's current state.
 *
 * ## Approved completeness rules (per gear, evaluated independently)
 *
 * - **Characteristics**: the gear has at least one supplied characteristic. The canonical record never
 *   persists which characteristics the Reference Data Service's gear catalogue marks `required` (that
 *   flag exists only transiently during the Step 23 save-time resolution and is discarded afterwards),
 *   so exact required-characteristic-ID matching is not evaluable here without a live external call —
 *   which the approved reliability requirements for this step explicitly forbid ("evaluate the in-memory
 *   canonical record without unnecessary external calls", "produce deterministic output for equivalent
 *   canonical input"). This is an explicit, approved scope decision (not a silently invented
 *   simplification): presence of at least one supplied characteristic is the approved completeness bar.
 * - **Statistical area**: the gear has exactly one approved canonical statistical-area object (a plain
 *   object carrying a non-empty `id`) — never an array, never a bare scalar, never absent/`null`.
 * - **Species caught**: the gear has at least one species relationship.
 * - **Catch details**: every species entry beneath the gear has at least one non-null weight field
 *   (`weightAboveMinimumKg`, `weightBelowMinimumKg`, or `weightLegallyDiscardedKg`) — approved decision:
 *   "at least one weight value of any kind" is the completeness bar for this dimension (Step 27
 *   redesign); no specific field is individually mandatory, since no approved source defines one.
 *
 * A gear is complete only when all four dimensions pass.
 *
 * ## Multi-gear aggregation
 *
 * - `incompleteGearAssociationIds` preserves the canonical `gears` array's own deterministic order and
 *   includes every incomplete gear exactly once (never excludes a legitimately incomplete gear, never
 *   invents server-generated identities for a gear missing its own `associationId`).
 * - `currentIncompleteGearAssociationId` is returned only when it is unambiguous: exactly one gear is
 *   incomplete. With zero or more than one incomplete gear, `null` is returned — sequencing which
 *   incomplete gear to address next is the frontend's journey concern (confirmed decision), not a
 *   backend-invented priority rule.
 * - `allGearsComplete` is `true` only when the `gears` collection is non-empty and every gear in it is
 *   complete. An empty or absent `gears` collection is never vacuously "complete" — the canonical
 *   hierarchy requires one or more gears, so "no gears yet" is incomplete, not satisfied.
 *
 * A gear association with a missing (non-string/empty) `associationId` cannot be identified in
 * `incompleteGearAssociationIds` (there is no stable identity to report), but if it is otherwise
 * incomplete it still correctly prevents `allGearsComplete` from becoming `true` — Step 26 evaluates
 * existing state and never repairs or invents an identity for a malformed association.
 */

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasAtLeastOneEntry(value) {
  return Array.isArray(value) && value.length > 0
}

const WEIGHT_FIELDS = Object.freeze([
  'weightAboveMinimumKg',
  'weightBelowMinimumKg',
  'weightLegallyDiscardedKg'
])

function isCompleteStatisticalArea(statisticalArea) {
  return isPlainObject(statisticalArea) && isNonEmptyString(statisticalArea.id)
}

function hasAtLeastOneWeight(speciesEntry) {
  if (!isPlainObject(speciesEntry)) {
    return false
  }

  return WEIGHT_FIELDS.some(
    (field) => speciesEntry[field] !== undefined && speciesEntry[field] !== null
  )
}

function hasCatchDetailsForEverySpecies(speciesCaught) {
  return speciesCaught.every((speciesEntry) =>
    hasAtLeastOneWeight(speciesEntry)
  )
}

/**
 * Evaluates one gear association's completeness in isolation. Never reads or is affected by any other
 * gear association — cross-gear contamination is structurally impossible since only the single supplied
 * `gear` object is ever inspected.
 *
 * @param {unknown} gear a single entry from the canonical `gears` collection
 * @returns {boolean} `true` only when every approved completeness dimension passes
 */
export function isGearComplete(gear) {
  if (!isPlainObject(gear)) {
    return false
  }

  const speciesCaught = Array.isArray(gear.speciesCaught)
    ? gear.speciesCaught
    : []

  return (
    hasAtLeastOneEntry(gear.characteristics) &&
    isCompleteStatisticalArea(gear.statisticalArea) &&
    speciesCaught.length > 0 &&
    hasCatchDetailsForEverySpecies(speciesCaught)
  )
}

/**
 * Evaluates multi-gear completeness and domain progress across the whole canonical `gears` collection.
 * Pure and immutable: `gears` (and every gear within it) is only ever read, never mutated or reordered.
 *
 * @param {unknown} gears the persisted canonical `gears` collection (a non-array value, including
 *   `undefined`/`null`, is treated defensively as an empty collection)
 * @returns {Readonly<{ incompleteGearAssociationIds: ReadonlyArray<string>,
 *   currentIncompleteGearAssociationId: string|null, allGearsComplete: boolean }>}
 */
export function evaluateGearsProgress(gears) {
  const gearAssociations = Array.isArray(gears) ? gears : []

  const incompleteGearAssociationIds = gearAssociations
    .filter((gear) => !isGearComplete(gear))
    .map((gear) => gear?.associationId)
    .filter(isNonEmptyString)

  const allGearsComplete =
    gearAssociations.length > 0 &&
    gearAssociations.every((gear) => isGearComplete(gear))

  const currentIncompleteGearAssociationId =
    incompleteGearAssociationIds.length === 1
      ? incompleteGearAssociationIds[0]
      : null

  return Object.freeze({
    incompleteGearAssociationIds: Object.freeze(incompleteGearAssociationIds),
    currentIncompleteGearAssociationId,
    allGearsComplete
  })
}
