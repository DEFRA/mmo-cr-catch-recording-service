import { randomUUID } from 'node:crypto'

import { ApplicationError } from '#/common/helpers/errors/application-error.js'
import { VALIDATION_CODES } from '#/catch-recording/validation/validation-codes.js'
import { formatPath } from '#/catch-recording/validation/validation-result.js'

/**
 * Step 23's pure gear reconciliation, extended by Step 24 for per-gear `statisticalArea` handling and by
 * the Step 27 redesign for per-gear `speciesCaught` handling. Given the already-resolved incoming gear
 * selections (fresh snapshots from the Reference Data Service - never a trusted client snapshot) and the
 * persisted record's current `gears` collection, decides, per incoming entry and in order:
 *
 * - **Retain** - a client-supplied `associationId` matches an existing gear association: the stable
 *   identity is preserved, `gear`/`characteristics` are refreshed from the resolved snapshot, and
 *   `statisticalArea`/`speciesCaught` each follow their own absent/present rule below.
 * - **New** - no client-supplied `associationId`: a fresh, stable identity is server-generated
 *   (`generateAssociationId`, defaulting to `randomUUID`); `statisticalArea`/`speciesCaught` still follow
 *   the same rules (a brand-new gear may be given a statistical area and/or species in the same save).
 * - **Rejected (Q2)** - a client-supplied `associationId` that matches no existing gear association for
 *   this record. Never silently minted as a new identity (that would allow identity forgery or the
 *   resurrection of a previously removed gear). Every rejected entry is aggregated into one thrown
 *   `BUSINESS_VALIDATION_FAILURE`/`SECTION_VALIDATION_FAILED` `ApplicationError`.
 *
 * **Step 24 `statisticalArea` rule** (mirrors the resolved entry's own absent/null/present distinction,
 * set by `resolve-gears-section.js`): if the resolved incoming entry does not own a `statisticalArea`
 * key, the gear's current statistical area is left exactly as it was (the existing one for a retained
 * gear, or none at all for a new gear); if the resolved entry's `statisticalArea` is `null`, the gear's
 * statistical area is explicitly cleared; if the resolved entry carries a resolved statistical-area
 * object, it replaces whatever the gear previously had.
 *
 * **`speciesCaught` rule (Step 27 redesign)** (mirrors the same absent/present distinction): if the
 * resolved incoming entry does not own a `speciesCaught` key, the gear's current species collection is
 * left exactly as it was; if it owns the key, the supplied, already-resolved collection *is* the gear's
 * new `speciesCaught` — used as-is, with no merge against any prior state. There is no synthetic
 * gear-to-species relationship `associationId` any more (service-owner decision): each entry is
 * identified purely by the species' own natural `id`, so a retained species' complete record (snapshot +
 * weights) is always rebuilt from what was supplied in this save, exactly mirroring the Step 23
 * gear-`characteristics` precedent ("a child collection is always rebuilt from the current payload,
 * never partially preserved").
 *
 * Every *other* gear association in the same save is completely unaffected by any of this — each entry's
 * `statisticalArea`/`speciesCaught` is decided independently from its own incoming data only.
 *
 * An existing gear association that is not retained is simply absent from the output - its nested
 * `statisticalArea`/`speciesCaught` cascade away automatically because they are nested under the gear
 * association that contained them, never root-level.
 *
 * Deterministic ordering: the output array's order mirrors `resolvedIncomingGears`'s order exactly.
 * Pure and immutable: neither input array nor any of their nested objects is ever mutated - every output
 * entry is a new, independent object built field-by-field (no spread of a trusted existing object that
 * could also carry an unexpected key).
 *
 * @param {Object} input
 * @param {ReadonlyArray<{ associationId?: string, gear: object, characteristics: ReadonlyArray<object>,
 *   statisticalArea?: object|null, speciesCaught?: ReadonlyArray<object> }>} input.resolvedIncomingGears
 *   each already resolved fresh from the Reference Data Service
 * @param {ReadonlyArray<object>} input.existingGears the persisted record's current `gears` collection
 * @param {() => string} [input.generateAssociationId] injected for deterministic testing; defaults to
 *   `randomUUID` from `node:crypto`
 * @returns {{ gears: Array<object>, removedAssociationIds: Array<string> }}
 * @throws {ApplicationError} `BUSINESS_VALIDATION_FAILURE`/`SECTION_VALIDATION_FAILED`, aggregating every
 *   unknown/forged gear-level `associationId` found (Q2)
 */
export function reconcileGears({
  resolvedIncomingGears,
  existingGears,
  generateAssociationId = randomUUID
}) {
  const existingByAssociationId = new Map(
    existingGears.map((existingGear) => [
      existingGear.associationId,
      existingGear
    ])
  )
  const retainedAssociationIds = new Set()
  const issues = []
  const gears = []

  resolvedIncomingGears.forEach((resolvedEntry, index) => {
    if (!hasClientAssociationId(resolvedEntry)) {
      gears.push(buildNewGear(resolvedEntry, generateAssociationId))
      return
    }

    const existingMatch = existingByAssociationId.get(
      resolvedEntry.associationId
    )

    if (!existingMatch) {
      issues.push(unknownAssociationIssue(index))
      return
    }

    retainedAssociationIds.add(resolvedEntry.associationId)
    gears.push(buildRetainedGear(resolvedEntry, existingMatch))
  })

  if (issues.length > 0) {
    throw sectionValidationError(issues)
  }

  const removedAssociationIds = existingGears
    .map((existingGear) => existingGear.associationId)
    .filter((associationId) => !retainedAssociationIds.has(associationId))

  return { gears, removedAssociationIds }
}

function hasClientAssociationId(resolvedEntry) {
  return (
    typeof resolvedEntry.associationId === 'string' &&
    resolvedEntry.associationId.length > 0
  )
}

function buildRetainedGear(resolvedEntry, existingMatch) {
  const retained = {
    associationId: existingMatch.associationId,
    gear: resolvedEntry.gear,
    characteristics: resolvedEntry.characteristics
  }

  assignStatisticalArea(retained, resolvedEntry, existingMatch)
  assignSpeciesCaught(retained, resolvedEntry, existingMatch)

  return retained
}

function buildNewGear(resolvedEntry, generateAssociationId) {
  const created = {
    associationId: generateAssociationId(),
    gear: resolvedEntry.gear,
    characteristics: resolvedEntry.characteristics
  }

  assignStatisticalArea(created, resolvedEntry, null)
  assignSpeciesCaught(created, resolvedEntry, null)

  return created
}

/**
 * Step 24: applies the resolved entry's own absent/null/present `statisticalArea` distinction (set by
 * `resolve-gears-section.js`) onto the output gear. `existingMatch` is `null` for a brand-new gear (which
 * has no prior statistical area to fall back to).
 *
 * @param {object} output the gear object under construction; mutated in place (not yet exposed to any
 *   caller outside this module)
 * @param {object} resolvedEntry
 * @param {object|null} existingMatch
 */
function assignStatisticalArea(output, resolvedEntry, existingMatch) {
  if (Object.hasOwn(resolvedEntry, 'statisticalArea')) {
    output.statisticalArea = resolvedEntry.statisticalArea
    return
  }

  if (existingMatch && Object.hasOwn(existingMatch, 'statisticalArea')) {
    output.statisticalArea = existingMatch.statisticalArea
  }
}

/**
 * Step 27 redesign: applies the resolved entry's own absent/present `speciesCaught` distinction (set by
 * `resolve-gears-section.js`) onto the output gear. An absent key preserves the gear's current
 * `speciesCaught` collection exactly as before (`existingMatch?.speciesCaught ?? []` for a brand-new
 * gear, which has none). A present key means the incoming, already-resolved `speciesCaught` is the
 * authoritative full species list for this gear in this save — it is used as-is (no merge with any
 * prior state): each entry is identified by the species' own natural `id` (no synthetic relationship
 * `associationId` any more), and a retained species' complete record (snapshot + weights) is always
 * rebuilt from what was supplied in this save, exactly mirroring the Step 23 gear-`characteristics`
 * precedent ("a child collection is always rebuilt from the current payload, never partially
 * preserved"). `existingMatch` is `null` for a brand-new gear.
 *
 * @param {object} output the gear object under construction; mutated in place (not yet exposed to any
 *   caller outside this module)
 * @param {object} resolvedEntry
 * @param {object|null} existingMatch
 */
function assignSpeciesCaught(output, resolvedEntry, existingMatch) {
  if (!Object.hasOwn(resolvedEntry, 'speciesCaught')) {
    output.speciesCaught = existingMatch?.speciesCaught ?? []
    return
  }

  output.speciesCaught = resolvedEntry.speciesCaught
}

function unknownAssociationIssue(index) {
  return {
    code: VALIDATION_CODES.INVALID_REFERENCE,
    path: formatPath(['gears', index, 'associationId']),
    message:
      'The supplied gear association could not be found on this catch record.'
  }
}

function sectionValidationError(issues) {
  return new ApplicationError({
    category: 'BUSINESS_VALIDATION_FAILURE',
    code: 'SECTION_VALIDATION_FAILED',
    message: 'The supplied section data is invalid.',
    details: issues
  })
}
