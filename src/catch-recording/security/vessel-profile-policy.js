import { decideVesselAccess } from './vessel-access-policy.js'

/**
 * Authorisation decision for vessel-owned convenience data (favourite gears/species/ports, vessel-owned
 * skippers). Distinctly named per the step prompt's file-by-file plan requirement, even though it shares
 * `decideVesselAccess`'s exact gating today - vessel-profile access never implies global skipper
 * permission, global reference-data modification, or any persistence/business operation, all of which
 * remain strictly out of scope for Step 14.
 *
 * @param {{ authenticationContext: { userId?: unknown } | null | undefined, vesselId: unknown,
 *   accessibleVesselIds: unknown }} input
 * @returns {Readonly<{ decision: string }>}
 */
export function decideVesselProfileAccess(input) {
  return decideVesselAccess(input)
}
