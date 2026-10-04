import { ApplicationError } from '#/common/helpers/errors/application-error.js'

import {
  normalizeGearEntry,
  normalizePairFishing,
  normalizeRetainedCatch,
  normalizeSpeciesCaughtEntry,
  normalizeStatisticalArea,
  normalizeTrip,
  normalizeVesselSnapshot
} from './catch-record-nested-normalizers.js'
import { normalizeIdentifier } from './catch-record-primitive-normalizers.js'

// Approved Catch Recording PATCH section catalogue (Step 06).
//
// Reconciled from design/design/catch-recording-service-design.md §12's suggested logical sections
// (`trip`, `pair-fishing`, `gear`, `gear-statistical-area`, `gear-species`, `retained-catch`, `skipper`)
// and §13's journey-progress example (`vessel`): `skipper` is removed (out of scope for Step 06 — a later
// phase), `vessel` is added, and `trip-dates`/`ports`/`gear-species-catch-details` are not separate
// sections because ports already nest inside `trip` and species attributes already nest inside each
// `speciesCaught` entry in the Step 05 canonical schema. See
// design/architecture/catch-record-input-normalisation.md §7 for the full rationale.
//
// This is a deliberately immutable allow-list: a section name that is not one of these seven keys can
// never invoke a normaliser, however it is supplied (no arbitrary object-path lookup is ever performed).
function requireGearAssociationId(context) {
  const gearAssociationId = context?.gearAssociationId

  if (
    typeof gearAssociationId !== 'string' ||
    gearAssociationId.trim() === ''
  ) {
    throw new ApplicationError(
      'INVALID_REQUEST',
      'This section requires an explicit gearAssociationId context.',
      {
        code: 'MISSING_GEAR_CONTEXT',
        details: [{ path: 'gearAssociationId', code: 'MISSING_GEAR_CONTEXT' }]
      }
    )
  }

  return normalizeIdentifier(gearAssociationId, { nullable: false })
}

export const CATCH_RECORD_SECTIONS = Object.freeze({
  vessel: Object.freeze({
    requiresGearContext: false,
    normalize: (input) => normalizeVesselSnapshot(input)
  }),
  trip: Object.freeze({
    requiresGearContext: false,
    normalize: (input) => normalizeTrip(input)
  }),
  'pair-fishing': Object.freeze({
    requiresGearContext: false,
    normalize: (input) => normalizePairFishing(input)
  }),
  gear: Object.freeze({
    requiresGearContext: false,
    normalize: (input) => normalizeGearEntry(input)
  }),
  'gear-statistical-area': Object.freeze({
    requiresGearContext: true,
    normalize: (input, context) => {
      requireGearAssociationId(context)
      return normalizeStatisticalArea(input)
    }
  }),
  'gear-species': Object.freeze({
    requiresGearContext: true,
    normalize: (input, context) => {
      requireGearAssociationId(context)
      return normalizeSpeciesCaughtEntry(input)
    }
  }),
  'retained-catch': Object.freeze({
    requiresGearContext: false,
    normalize: (input) => normalizeRetainedCatch(input)
  })
})

export function isCatchRecordSection(name) {
  return Object.hasOwn(CATCH_RECORD_SECTIONS, name)
}

export function normalizeCatchRecordSection(sectionName, input, context = {}) {
  if (!isCatchRecordSection(sectionName)) {
    throw new ApplicationError(
      'INVALID_REQUEST',
      'The requested Catch Recording section is not supported.',
      {
        code: 'UNSUPPORTED_SECTION',
        details: [{ path: 'section', code: 'UNSUPPORTED_SECTION' }]
      }
    )
  }

  return CATCH_RECORD_SECTIONS[sectionName].normalize(input, context)
}
