import { ApplicationError } from '#/common/helpers/errors/application-error.js'
import { enforcePolicyOutcome } from '../security/policy-errors.js'
import { decideVesselProfileAccess } from '../security/vessel-profile-policy.js'

/**
 * Shared vessel-profile access helpers reused by `vessel-favourites.js` and `vessel-skippers.js` — the
 * one place both controllers enforce vessel authorisation, matching `create-draft-catch-record.js`'s
 * `resolveAuthorisedVessel` composition (accessible-vessel-ids fact from the Reference Data Service,
 * then the Step 14 vessel-profile policy). Not a general-purpose utility module — scoped exactly to
 * what Step 39's two controllers need.
 */

export function requireVesselId(vesselId) {
  if (typeof vesselId !== 'string' || vesselId.trim().length === 0) {
    throw new ApplicationError({
      category: 'INVALID_REQUEST',
      code: 'VESSEL_ID_REQUIRED',
      message: 'A vessel id is required.'
    })
  }
}

export function trustedNowIso() {
  return new Date().toISOString()
}

/**
 * @param {Object} input
 * @param {string} input.vesselId
 * @param {object} input.referenceDataClient Step 15 Reference Data Service client
 * @param {{ userId?: unknown } | null | undefined} input.authenticationContext
 * @param {string} [input.correlationId]
 */
export async function enforceVesselProfileAccess({
  vesselId,
  referenceDataClient,
  authenticationContext,
  correlationId
}) {
  const accessibleVesselIds = await referenceDataClient.listAccessibleVesselIds(
    { correlationId }
  )

  enforcePolicyOutcome(
    decideVesselProfileAccess({
      authenticationContext,
      vesselId,
      accessibleVesselIds
    })
  )
}
