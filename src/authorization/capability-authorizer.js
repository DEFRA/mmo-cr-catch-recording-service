import { safeLog } from '#/common/helpers/logging/safe-log.js'
import { isAuthenticatedUserContext } from '#/authentication/entra/authenticated-user-context.js'
import { isValidIdentifier } from './authorization-response-validator.js'
import { UserProfileOutcome } from './user-profile-client.js'
import { SnapshotState } from './role-definitions-cache.js'
import { parseVesselScopedRole } from './vessel-scoped-role.js'

export const AuthorizationOutcome = Object.freeze({
  ALLOWED: 'allowed',
  DENIED: 'denied',
  UNAVAILABLE: 'unavailable'
})

/** Valid evaluated denials: authorization data was available and nothing grants the capability. */
export const DenialReason = Object.freeze({
  NO_ASSIGNED_ROLES: 'NO_ASSIGNED_ROLES',
  ALL_ASSIGNED_ROLES_UNKNOWN: 'ALL_ASSIGNED_ROLES_UNKNOWN',
  CAPABILITY_NOT_GRANTED: 'CAPABILITY_NOT_GRANTED',
  REQUIRED_CAPABILITY_UNKNOWN: 'REQUIRED_CAPABILITY_UNKNOWN'
})

/** Authorization could not be evaluated: never a denial, never an allow. */
export const UnavailableReason = Object.freeze({
  UNTRUSTED_USER_CONTEXT: 'UNTRUSTED_USER_CONTEXT',
  INVALID_REQUIRED_CAPABILITY: 'INVALID_REQUIRED_CAPABILITY',
  USER_ROLES_UNAVAILABLE: 'USER_ROLES_UNAVAILABLE',
  ROLE_DEFINITIONS_UNAVAILABLE: 'ROLE_DEFINITIONS_UNAVAILABLE',
  ROLE_DEFINITIONS_OVER_STALE: 'ROLE_DEFINITIONS_OVER_STALE',
  AUTHORIZATION_DATA_INVALID: 'AUTHORIZATION_DATA_INVALID',
  CANCELLED: 'CANCELLED',
  INTERNAL_FAILURE: 'INTERNAL_FAILURE'
})

// Only capabilities built by `createRequiredCapability` are accepted, so a role id or an arbitrary
// string can never be used as a required capability by accident.
const issuedCapabilities = new WeakSet()

/**
 * Creates one immutable required-capability value holding an exact identifier (no trimming, case change,
 * wildcard or alias handling). Throws for a missing or malformed identifier.
 *
 * @param {string} capabilityId for example `catch-record.read`
 * @returns {Readonly<{ capabilityId: string }>}
 */
export function createRequiredCapability(capabilityId) {
  if (!isValidIdentifier(capabilityId)) {
    throw new TypeError(
      'A required capability must be a valid exact identifier'
    )
  }

  const capability = Object.freeze({ capabilityId })
  issuedCapabilities.add(capability)
  return capability
}

/**
 * @param {unknown} value
 * @returns {boolean} true only for a value created by {@link createRequiredCapability}
 */
export function isRequiredCapability(value) {
  return issuedCapabilities.has(value)
}

// Derived, immutable lookup tables, memoised per frozen snapshot and released with it
const indexes = new WeakMap()

function indexOf(snapshot) {
  let index = indexes.get(snapshot)
  if (!index) {
    const capabilitiesByRole = new Map()
    const knownCapabilities = new Set()
    for (const { roleId, capabilityIds } of snapshot.roles) {
      capabilitiesByRole.set(roleId, new Set(capabilityIds))
      capabilityIds.forEach((capabilityId) =>
        knownCapabilities.add(capabilityId)
      )
    }
    index = Object.freeze({ capabilitiesByRole, knownCapabilities })
    indexes.set(snapshot, index)
  }
  return index
}

const unavailable = (reason, detail = null) =>
  Object.freeze({
    outcome: AuthorizationOutcome.UNAVAILABLE,
    reason,
    ...(detail ? { detail } : {})
  })

function describeFailure(failure) {
  return failure.source === 'dependency'
    ? { source: failure.source, outcome: failure.outcome }
    : { source: failure.source, reason: failure.reason }
}

function isCancellation(failure) {
  return (
    failure.source === 'dependency' &&
    failure.outcome === UserProfileOutcome.CANCELLED
  )
}

function unavailableForUserRoles(failure) {
  if (isCancellation(failure)) {
    return unavailable(UnavailableReason.CANCELLED)
  }
  return unavailable(
    failure.source === 'validation'
      ? UnavailableReason.AUTHORIZATION_DATA_INVALID
      : UnavailableReason.USER_ROLES_UNAVAILABLE,
    describeFailure(failure)
  )
}

function unavailableForDefinitions(failure) {
  if (isCancellation(failure)) {
    return unavailable(UnavailableReason.CANCELLED)
  }
  if (failure.snapshotState === SnapshotState.OVER_STALE) {
    return unavailable(
      UnavailableReason.ROLE_DEFINITIONS_OVER_STALE,
      describeFailure(failure)
    )
  }
  return unavailable(
    failure.source === 'validation'
      ? UnavailableReason.AUTHORIZATION_DATA_INVALID
      : UnavailableReason.ROLE_DEFINITIONS_UNAVAILABLE,
    describeFailure(failure)
  )
}

const DECISION_EVENT = 'authorization.decision'

function collectGrants(roleIds, capabilitiesByRole, capabilityId) {
  // Assigned roles are `[vessel]--[role]`: the role's capabilities apply to that vessel only
  let unknownRoleCount = 0
  const grantingVesselIds = new Set()
  for (const assignedRoleId of roleIds) {
    const scoped = parseVesselScopedRole(assignedRoleId)
    const capabilities = scoped && capabilitiesByRole.get(scoped.roleId)
    if (!capabilities) {
      unknownRoleCount += 1
    } else if (capabilities.has(capabilityId)) {
      grantingVesselIds.add(scoped.vesselId)
    } else {
      // a known role that does not grant this capability neither grants nor counts as unknown
    }
  }

  return { unknownRoleCount, grantingVesselIds }
}

function evaluate(roleIds, snapshot, { capabilityId, vesselId }, context) {
  const { capabilitiesByRole, knownCapabilities } = indexOf(snapshot)
  const base = {
    capability: capabilityId,
    definitionsVersion: snapshot.definitionsVersion,
    ...context
  }

  if (!knownCapabilities.has(capabilityId)) {
    return Object.freeze({
      outcome: AuthorizationOutcome.DENIED,
      reason: DenialReason.REQUIRED_CAPABILITY_UNKNOWN,
      ...base
    })
  }

  const { unknownRoleCount, grantingVesselIds } = collectGrants(
    roleIds,
    capabilitiesByRole,
    capabilityId
  )
  const granted =
    vesselId === undefined
      ? grantingVesselIds.size > 0
      : grantingVesselIds.has(vesselId)
  if (granted) {
    return Object.freeze({
      outcome: AuthorizationOutcome.ALLOWED,
      ...base,
      grantedVesselIds: Object.freeze(
        vesselId === undefined ? [...grantingVesselIds] : [vesselId]
      ),
      unknownRoleCount
    })
  }

  return Object.freeze({
    outcome: AuthorizationOutcome.DENIED,
    reason:
      unknownRoleCount === roleIds.length
        ? DenialReason.ALL_ASSIGNED_ROLES_UNKNOWN
        : DenialReason.CAPABILITY_NOT_GRANTED,
    ...base,
    unknownRoleCount
  })
}

function hasValidRequest(capability, vesselId) {
  return (
    issuedCapabilities.has(capability) &&
    (vesselId === undefined || isValidIdentifier(vesselId))
  )
}

async function decide(
  { userRoleCache, roleDefinitionsCache },
  user,
  capability,
  { vesselId, correlationId, signal }
) {
  if (!isAuthenticatedUserContext(user)) {
    return unavailable(UnavailableReason.UNTRUSTED_USER_CONTEXT)
  }
  if (!hasValidRequest(capability, vesselId)) {
    return unavailable(UnavailableReason.INVALID_REQUIRED_CAPABILITY)
  }

  const userRoles = await userRoleCache.getUserRoles(user, {
    correlationId,
    signal
  })
  if (!userRoles.ok) {
    return unavailableForUserRoles(userRoles)
  }

  const { capabilityId } = capability
  const userRoleCacheState = userRoles.cacheState
  if (userRoles.value.roleIds.length === 0) {
    return Object.freeze({
      outcome: AuthorizationOutcome.DENIED,
      reason: DenialReason.NO_ASSIGNED_ROLES,
      capability: capabilityId,
      userRoleCacheState
    })
  }

  const definitions = await roleDefinitionsCache.getRoleDefinitions({
    correlationId,
    signal
  })
  if (!definitions.ok) {
    return unavailableForDefinitions(definitions)
  }

  return evaluate(
    userRoles.value.roleIds,
    definitions.snapshot,
    { capabilityId, vesselId },
    {
      userRoleCacheState,
      roleDefinitionsCacheState: definitions.cacheState,
      staleDefinitionsUsed: definitions.freshness === SnapshotState.STALE
    }
  )
}

function logDecision(logger, decision, correlationId, durationMs) {
  const entry = {
    event: DECISION_EVENT,
    outcome: decision.outcome,
    reason: decision.reason ?? 'granted',
    capability: decision.capability,
    definitionsVersion: decision.definitionsVersion,
    userRoleCacheState: decision.userRoleCacheState,
    roleDefinitionsCacheState: decision.roleDefinitionsCacheState,
    staleDefinitionsUsed: decision.staleDefinitionsUsed,
    unknownRoleCount: decision.unknownRoleCount,
    correlationId,
    durationMs
  }
  const level =
    decision.outcome === AuthorizationOutcome.UNAVAILABLE ? 'warn' : 'debug'
  safeLog(logger, level, entry, DECISION_EVENT)
}

/**
 * Evaluates the approved any-role-grants rule for one required capability. Stateless: it holds no
 * authorization data of its own and consumes only the Step 07 and Step 08 cache contracts.
 *
 * Assigned roles have the form `[vessel]--[role]` (for example `VRO5--Owner`): the role part is looked up
 * in the role definitions and its capabilities apply to that vessel only. A role that is not of that form
 * is unrecognised and grants nothing.
 *
 * Decision order (deterministic):
 *  1. no trusted user context, or an invalid required capability -> unavailable (fail closed);
 *  2. user-role data unavailable (incl. expired + failed refresh, invalid data, cancellation) -> unavailable;
 *  3. valid but empty roles (unknown user or no roles) -> denied, without loading role definitions;
 *  4. role definitions unavailable (incl. over-stale, absent + failed load) -> unavailable;
 *  5. required capability absent from every current definition -> denied;
 *  6. no known assigned role grants the exact capability -> denied;
 *  7. at least one known assigned role grants it -> allowed, listing the vessels it was granted for (when
 *     a vessel is supplied only a role assigned for that exact vessel counts; unknown roles grant nothing
 *     and never block).
 *
 * @param {Object} options
 * @param {{ getUserRoles: Function }} options.userRoleCache Step 07
 * @param {{ getRoleDefinitions: Function }} options.roleDefinitionsCache Step 08
 * @param {{ debug: Function, warn: Function }} [options.logger]
 * @param {() => number} [options.now] monotonic millisecond clock for decision latency
 */
export function createCapabilityAuthorizer({
  userRoleCache,
  roleDefinitionsCache,
  logger,
  now = () => performance.now()
}) {
  const caches = { userRoleCache, roleDefinitionsCache }

  /**
   * @param {Readonly<{ userId: string }>} user the trusted Step 04 authenticated-user context
   * @param {Readonly<{ capabilityId: string }>} capability from `createRequiredCapability`
   * @param {{ vesselId?: string, correlationId?: string, signal?: AbortSignal }} [options] `vesselId`
   *   restricts the check to roles assigned for that exact vessel; without it any vessel suffices and the
   *   allowed decision lists the vessels (`grantedVesselIds`) for resource-level composition
   * @returns {Promise<Readonly<{ outcome: 'allowed' | 'denied' | 'unavailable', reason?: string }>>}
   */
  async function authorize(
    user,
    capability,
    { vesselId, correlationId, signal } = {}
  ) {
    const startedAt = now()
    let decision
    try {
      decision = await decide(caches, user, capability, {
        vesselId,
        correlationId,
        signal
      })
    } catch {
      decision = unavailable(UnavailableReason.INTERNAL_FAILURE)
    }

    logDecision(logger, decision, correlationId, now() - startedAt)

    return decision
  }

  return { authorize }
}
