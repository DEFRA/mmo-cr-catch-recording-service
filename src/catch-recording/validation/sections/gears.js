import { VALIDATION_CODES } from '../validation-codes.js'
import {
  createInvalidResult,
  createValidResult,
  formatPath
} from '../validation-result.js'

function issue(code, pathSegments, message) {
  return { code, path: formatPath(pathSegments), message }
}

/**
 * Detects duplicate gear-association IDs, and duplicate species-association IDs within the same gear.
 * The same authoritative species appearing under two different gear associations is explicitly valid
 * and is never flagged — only a duplicate species-association `associationId` within one gear is
 * flagged, since that is the stable relationship identity the canonical contract requires to be unique.
 *
 * @param {unknown} gears
 * @returns {{ valid: boolean, issues: ReadonlyArray<object> }}
 */
export function validateGears(gears) {
  if (!Array.isArray(gears)) {
    return createValidResult()
  }

  const issues = []
  const seenGearAssociationIds = new Set()

  gears.forEach((gearAssociation, gearIndex) => {
    if (typeof gearAssociation !== 'object' || gearAssociation === null) {
      return
    }

    const { associationId } = gearAssociation
    if (typeof associationId === 'string' && associationId.trim().length > 0) {
      if (seenGearAssociationIds.has(associationId)) {
        issues.push(
          issue(
            VALIDATION_CODES.DUPLICATE_RELATIONSHIP,
            ['gears', gearIndex, 'associationId'],
            'Duplicate gear association'
          )
        )
      }
      seenGearAssociationIds.add(associationId)
    }

    if (!Array.isArray(gearAssociation.speciesCaught)) {
      return
    }

    const seenSpeciesAssociationIds = new Set()
    gearAssociation.speciesCaught.forEach(
      (speciesAssociation, speciesIndex) => {
        if (
          typeof speciesAssociation !== 'object' ||
          speciesAssociation === null
        ) {
          return
        }

        const speciesAssociationId = speciesAssociation.associationId
        if (
          typeof speciesAssociationId === 'string' &&
          speciesAssociationId.trim().length > 0
        ) {
          if (seenSpeciesAssociationIds.has(speciesAssociationId)) {
            issues.push(
              issue(
                VALIDATION_CODES.DUPLICATE_RELATIONSHIP,
                [
                  'gears',
                  gearIndex,
                  'speciesCaught',
                  speciesIndex,
                  'associationId'
                ],
                'Duplicate species association within this gear'
              )
            )
          }
          seenSpeciesAssociationIds.add(speciesAssociationId)
        }
      }
    )
  })

  return issues.length === 0 ? createValidResult() : createInvalidResult(issues)
}
