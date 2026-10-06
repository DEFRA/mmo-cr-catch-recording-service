import { isApplicationError } from '#/common/helpers/errors/application-error.js'
import {
  createValidResult,
  createInvalidResult,
  formatPath
} from '#/catch-recording/validation/validation-result.js'
import { VALIDATION_CODES } from '#/catch-recording/validation/validation-codes.js'
import { decideVesselAccess } from '#/catch-recording/security/vessel-access-policy.js'
import { enforcePolicyOutcome } from '#/catch-recording/security/policy-errors.js'
import { isVesselSelectable } from './active-selection.js'
import { mapVesselSnapshot } from './snapshot-mappers.js'

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0
}

/**
 * Vessel resolution and vessel access are two separate decisions, composed here in the approved order:
 *
 * 1. Validate the vessel ID primitive.
 * 2. Resolve the authoritative vessel through Step 15.
 * 3. Confirm current selection eligibility (active-selection).
 * 4. Evaluate access through the Step 14 vessel-access policy, using only the supplied, already-trusted
 *    `accessibleVesselIds` fact - this function never calls the Reference Data Service a second time,
 *    never calls an authorisation service itself, and never caches a permission or a vessel detail.
 * 5. Only after every prior step succeeds is the canonical vessel snapshot returned.
 *
 * Vessel existence is never treated as proof of access, and vessel access is never treated as proof the
 * vessel exists - both must independently succeed.
 *
 * @param {Object} input
 * @param {unknown} input.id
 * @param {Array<string|number>} input.path canonical path segments up to (not including) `id`
 * @param {{ getVesselById: Function }} input.client the Step 15 Reference Data Service client
 * @param {{ userId?: unknown } | null | undefined} input.authenticationContext the Step 13 context
 * @param {unknown} input.accessibleVesselIds the trusted, already-resolved vessel-access fact
 * @param {string} [input.correlationId]
 * @returns {Promise<{ result: object, snapshot: object|null }>}
 */
export async function resolveVessel({
  id,
  path,
  client,
  authenticationContext,
  accessibleVesselIds,
  correlationId
}) {
  const idPath = formatPath([...path, 'id'])

  if (id === undefined || id === null) {
    return {
      result: createInvalidResult({
        code: VALIDATION_CODES.REQUIRED,
        path: idPath,
        message: 'A vessel id is required.'
      }),
      snapshot: null
    }
  }

  if (!isNonEmptyString(id)) {
    return {
      result: createInvalidResult({
        code: VALIDATION_CODES.INVALID_STRUCTURE,
        path: idPath,
        message: 'The vessel id must be a non-empty string.'
      }),
      snapshot: null
    }
  }

  let vessel
  try {
    vessel = await client.getVesselById(id, { correlationId })
  } catch (cause) {
    if (isApplicationError(cause) && cause.category === 'RESOURCE_NOT_FOUND') {
      return {
        result: createInvalidResult({
          code: VALIDATION_CODES.INVALID_REFERENCE,
          path: idPath,
          message: 'The selected vessel could not be found.'
        }),
        snapshot: null
      }
    }
    throw cause
  }

  if (!isVesselSelectable(vessel)) {
    return {
      result: createInvalidResult({
        code: VALIDATION_CODES.INVALID_REFERENCE,
        path: idPath,
        message: 'The selected vessel is no longer active.'
      }),
      snapshot: null
    }
  }

  // Access is evaluated only now, using the trusted fact already supplied - never by re-deriving
  // permission from the vessel just resolved, and never before active-selection is confirmed.
  enforcePolicyOutcome(
    decideVesselAccess({
      authenticationContext,
      vesselId: id,
      accessibleVesselIds
    })
  )

  return {
    result: createValidResult(),
    snapshot: mapVesselSnapshot(vessel)
  }
}
