import { isValidIdentifier } from './authorization-response-validator.js'

const SEPARATOR = '--'

/**
 * Parses an assigned role of the approved form `[vessel]--[role]` (for example `VRO5--Owner`) into the
 * vessel it applies to and the role whose capabilities it carries. Exactly one separator is required and
 * both parts must be non-empty valid identifiers, so any other value (an unscoped role, a missing vessel
 * or role, a second separator) is not a recognisable vessel role and grants nothing.
 *
 * No case folding, trimming or other normalisation is applied.
 *
 * @param {unknown} assignedRoleId a validated assigned role identifier
 * @returns {Readonly<{ vesselId: string, roleId: string }> | null}
 */
export function parseVesselScopedRole(assignedRoleId) {
  if (typeof assignedRoleId !== 'string') {
    return null
  }

  const parts = assignedRoleId.split(SEPARATOR)
  if (parts.length !== 2) {
    return null
  }

  const [vesselId, roleId] = parts
  return isValidIdentifier(vesselId) && isValidIdentifier(roleId)
    ? Object.freeze({ vesselId, roleId })
    : null
}
