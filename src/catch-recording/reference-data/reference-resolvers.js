import { isApplicationError } from '#/common/helpers/errors/application-error.js'
import {
  createValidResult,
  createInvalidResult,
  formatPath
} from '#/catch-recording/validation/validation-result.js'
import { VALIDATION_CODES } from '#/catch-recording/validation/validation-codes.js'
import { isSelectable } from './active-selection.js'
import {
  mapPortSnapshot,
  mapGearSnapshot,
  mapStatisticalAreaSnapshot,
  mapSpeciesSnapshot,
  mapGearCharacteristicSnapshot
} from './snapshot-mappers.js'

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0
}

function requiredResult(path, message) {
  return createInvalidResult({ code: VALIDATION_CODES.REQUIRED, path, message })
}

function malformedResult(path, message) {
  return createInvalidResult({
    code: VALIDATION_CODES.INVALID_STRUCTURE,
    path,
    message
  })
}

function invalidReferenceResult(path, message) {
  return createInvalidResult({
    code: VALIDATION_CODES.INVALID_REFERENCE,
    path,
    message
  })
}

/**
 * The shared shape returned by every resolver: `result` is the Step 07 validation-result contract;
 * `snapshot` is the mapped canonical Snapshot (only when `result.valid`); `resolved` is the raw,
 * strictly-validated Step 15 result (only when `result.valid`) - exposed only for relationship
 * composition (e.g. `resolveGear`'s own characteristic check), never for direct external use.
 *
 * A Step 15 `RESOURCE_NOT_FOUND` is translated into an `INVALID_REFERENCE` business-validation issue -
 * the one deliberate exception to "dependency failures stay distinct from validation outcomes", because
 * an unknown authoritative reference is itself the business outcome being validated. Every other Step 15
 * `ApplicationError` category (`UPSTREAM_TIMEOUT`, `DEPENDENCY_UNAVAILABLE`, `UPSTREAM_INVALID_RESPONSE`)
 * is rethrown unchanged.
 *
 * @param {Object} input
 * @param {unknown} input.id
 * @param {Array<string|number>} input.path canonical path segments up to (not including) `id`
 * @param {string} input.resourceLabel safe, human-readable resource name for messages (never the raw id)
 * @param {(id: string) => Promise<object>} input.fetchById
 * @param {(resolved: object) => boolean} input.isActive
 * @param {(resolved: object) => object} input.mapSnapshot
 * @returns {Promise<{ result: object, snapshot: object|null, resolved: object|null }>}
 */
async function resolveReference({
  id,
  path,
  resourceLabel,
  fetchById,
  isActive,
  mapSnapshot
}) {
  const idPath = formatPath([...path, 'id'])

  if (id === undefined || id === null) {
    return {
      result: requiredResult(idPath, `A ${resourceLabel} id is required.`),
      snapshot: null,
      resolved: null
    }
  }

  if (!isNonEmptyString(id)) {
    return {
      result: malformedResult(
        idPath,
        `The ${resourceLabel} id must be a non-empty string.`
      ),
      snapshot: null,
      resolved: null
    }
  }

  let resolved
  try {
    resolved = await fetchById(id)
  } catch (cause) {
    if (isApplicationError(cause) && cause.category === 'RESOURCE_NOT_FOUND') {
      return {
        result: invalidReferenceResult(
          idPath,
          `The selected ${resourceLabel} could not be found.`
        ),
        snapshot: null,
        resolved: null
      }
    }
    // Every other dependency failure (timeout, unavailable, invalid upstream response) stays distinct
    // from a validation outcome and is rethrown unchanged.
    throw cause
  }

  if (!isActive(resolved)) {
    return {
      result: invalidReferenceResult(
        idPath,
        `The selected ${resourceLabel} is no longer active.`
      ),
      snapshot: null,
      resolved: null
    }
  }

  return {
    result: createValidResult(),
    snapshot: mapSnapshot(resolved),
    resolved
  }
}

/**
 * @param {{ id: unknown, path: Array<string|number>, client: object, correlationId?: string }} input
 */
export function resolvePort({ id, path, client, correlationId }) {
  return resolveReference({
    id,
    path,
    resourceLabel: 'port',
    fetchById: (portId) => client.getPortById(portId, { correlationId }),
    isActive: isSelectable,
    mapSnapshot: mapPortSnapshot
  })
}

/**
 * @param {{ id: unknown, path: Array<string|number>, client: object, correlationId?: string }} input
 */
export function resolveStatisticalArea({ id, path, client, correlationId }) {
  return resolveReference({
    id,
    path,
    resourceLabel: 'statistical area',
    fetchById: (areaId) =>
      client.getStatisticalAreaById(areaId, { correlationId }),
    isActive: () => true,
    mapSnapshot: mapStatisticalAreaSnapshot
  })
}

/**
 * @param {{ id: unknown, path: Array<string|number>, client: object, correlationId?: string }} input
 */
export function resolveSpecies({ id, path, client, correlationId }) {
  return resolveReference({
    id,
    path,
    resourceLabel: 'species',
    fetchById: (speciesId) =>
      client.getSpeciesById(speciesId, { correlationId }),
    isActive: isSelectable,
    mapSnapshot: mapSpeciesSnapshot
  })
}

/**
 * Resolves a gear selection. `resolved.characteristics` (already joined with the Reference Data
 * Service's characteristic catalogue by Step 15) is exposed in the return value so a caller validating a
 * selected gear characteristic can confirm it belongs to this gear (the one relationship the Reference
 * Data Service actually supports - see the Step 16 plan's "Recorded gap" for gear↔area/gear↔species,
 * which have no supporting field anywhere in the confirmed schemas).
 *
 * @param {{ id: unknown, path: Array<string|number>, client: object, correlationId?: string }} input
 */
export function resolveGear({ id, path, client, correlationId }) {
  return resolveReference({
    id,
    path,
    resourceLabel: 'gear',
    fetchById: (gearId) => client.getGearById(gearId, { correlationId }),
    isActive: isSelectable,
    mapSnapshot: mapGearSnapshot
  })
}

/**
 * Validates that a selected gear-characteristic ID belongs to the already-resolved gear (the one
 * relationship the Reference Data Service actually supports), then maps its snapshot. Takes the
 * `resolved` gear returned by a prior successful `resolveGear` call - it never re-fetches the gear
 * itself.
 *
 * @param {{ characteristicId: unknown, path: Array<string|number>, gear: { characteristics: Array<{
 *   characteristicId: string }> } }} input
 * @returns {{ result: object, snapshot: object|null }}
 */
export function resolveGearCharacteristic({ characteristicId, path, gear }) {
  const idPath = formatPath([...path, 'characteristicId'])

  if (characteristicId === undefined || characteristicId === null) {
    return {
      result: requiredResult(idPath, 'A gear characteristic id is required.'),
      snapshot: null
    }
  }

  if (!isNonEmptyString(characteristicId)) {
    return {
      result: malformedResult(
        idPath,
        'The gear characteristic id must be a non-empty string.'
      ),
      snapshot: null
    }
  }

  const match = gear.characteristics.find(
    (characteristic) => characteristic.characteristicId === characteristicId
  )

  if (!match) {
    return {
      result: invalidReferenceResult(
        idPath,
        'The selected characteristic does not belong to this gear.'
      ),
      snapshot: null
    }
  }

  return {
    result: createValidResult(),
    snapshot: mapGearCharacteristicSnapshot(match)
  }
}
