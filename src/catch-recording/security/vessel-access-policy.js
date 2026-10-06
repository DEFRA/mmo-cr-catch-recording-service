import {
  allowOutcome,
  denyOutcome,
  POLICY_DECISIONS
} from './policy-outcome.js'

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0
}

function isValidAccessibleVesselIds(value) {
  return Array.isArray(value) && value.every((id) => isNonEmptyString(id))
}

/**
 * Pure vessel-access policy. `vesselId` is treated as an opaque stable identifier - never
 * case-normalised, never trusted from a request payload. `accessibleVesselIds` is the trusted,
 * already-resolved fact the caller supplies (eventually populated by Step 16's Reference Data Service
 * composition - this policy never calls an external service, queries MongoDB, or caches a permission
 * itself). Deny with `ACCESS_DENIED`, not `NOT_FOUND`: a vessel identifier is reference data, not an
 * owner-secret Catch Record.
 *
 * @param {{ authenticationContext: { userId?: unknown } | null | undefined, vesselId: unknown,
 *   accessibleVesselIds: unknown }} input
 * @returns {Readonly<{ decision: string }>}
 */
export function decideVesselAccess({
  authenticationContext,
  vesselId,
  accessibleVesselIds
} = {}) {
  if (!isNonEmptyString(authenticationContext?.userId)) {
    return denyOutcome(POLICY_DECISIONS.AUTHENTICATION_REQUIRED)
  }

  if (!isNonEmptyString(vesselId)) {
    return denyOutcome(POLICY_DECISIONS.ACCESS_DENIED)
  }

  if (!isValidAccessibleVesselIds(accessibleVesselIds)) {
    return denyOutcome(POLICY_DECISIONS.ACCESS_DENIED)
  }

  return accessibleVesselIds.includes(vesselId)
    ? allowOutcome()
    : denyOutcome(POLICY_DECISIONS.ACCESS_DENIED)
}
