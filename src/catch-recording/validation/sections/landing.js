import { VALIDATION_CODES } from '../validation-codes.js'
import {
  createInvalidResult,
  createValidResult,
  formatPath
} from '../validation-result.js'

function issue(code, pathSegments, message) {
  return { code, path: formatPath(pathSegments), message }
}

function buildSpeciesAssociationIdsByGear(gears) {
  const map = new Map()

  if (!Array.isArray(gears)) {
    return map
  }

  for (const gearAssociation of gears) {
    if (typeof gearAssociation !== 'object' || gearAssociation === null) {
      continue
    }

    const { associationId } = gearAssociation
    if (
      typeof associationId !== 'string' ||
      associationId.trim().length === 0
    ) {
      continue
    }

    const speciesAssociationIds = new Set(
      Array.isArray(gearAssociation.speciesCaught)
        ? gearAssociation.speciesCaught
            .filter(
              (species) => typeof species === 'object' && species !== null
            )
            .map((species) => species.associationId)
            .filter((id) => typeof id === 'string' && id.trim().length > 0)
        : []
    )

    map.set(associationId, speciesAssociationIds)
  }

  return map
}

/**
 * Validates that every `retainedSpecies` entry's `gearAssociationId`/`speciesAssociationId` reference an
 * existing gear association and a species association under that same gear, in the current Catch
 * Record — the only approved internal cross-reference rule (functional requirement #11). Does not
 * validate `intention`, `notLandingDetails`, or any other landing semantics, which remain deferred to
 * Step 27.
 *
 * @param {unknown} landing
 * @param {unknown} gears
 * @returns {{ valid: boolean, issues: ReadonlyArray<object> }}
 */
export function validateLanding(landing, gears) {
  if (typeof landing !== 'object' || landing === null) {
    return createValidResult()
  }

  if (!Array.isArray(landing.retainedSpecies)) {
    return createValidResult()
  }

  const speciesAssociationIdsByGear = buildSpeciesAssociationIdsByGear(gears)
  const issues = []

  landing.retainedSpecies.forEach((retained, index) => {
    if (typeof retained !== 'object' || retained === null) {
      return
    }

    const pathSegments = ['landing', 'retainedSpecies', index]
    const { gearAssociationId, speciesAssociationId } = retained

    if (!speciesAssociationIdsByGear.has(gearAssociationId)) {
      issues.push(
        issue(
          VALIDATION_CODES.INVALID_REFERENCE,
          [...pathSegments, 'gearAssociationId'],
          'Does not reference an existing gear association in this Catch Record'
        )
      )
      return
    }

    const speciesAssociationIds =
      speciesAssociationIdsByGear.get(gearAssociationId)
    if (!speciesAssociationIds.has(speciesAssociationId)) {
      issues.push(
        issue(
          VALIDATION_CODES.INVALID_REFERENCE,
          [...pathSegments, 'speciesAssociationId'],
          'Does not reference an existing species association under the referenced gear'
        )
      )
    }
  })

  return issues.length === 0 ? createValidResult() : createInvalidResult(issues)
}
