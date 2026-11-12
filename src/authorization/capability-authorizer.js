import { isAuthenticatedUserContext } from '#/authentication/entra/authenticated-user-context.js'
import { isValidIdentifier } from './authorization-response-validator.js'
import { UserProfileOutcome } from './user-profile-client.js'
import { SnapshotState } from './role-definitions-cache.js'

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

/**
 * Evaluates the approved any-role-grants rule for one required capability. Stateless: it holds no
 * authorization data of its own and consumes only the Step 07 and Step 08 cache contracts.
 *
 * Decision order (deterministic):
 *  1. no trusted user context, or an invalid required capability -> unavailable (fail closed);
 *  2. user-role data unavailable (incl. expired + failed refresh, invalid data, cancellation) -> unavailable;
 *  3. valid but empty roles (unknown user or no roles) -> denied, without loading role definitions;
 *  4. role definitions unavailable (incl. over-stale, absent + failed load) -> unavailable;
 *  5. required capability absent from every current definition -> denied;
 *  6. no known assigned role grants the exact capability -> denied;
 *  7. at least one known assigned role grants it -> allowed (unknown roles grant nothing and never block).
 *
 * @param {Object} options
 * @param {{ getUserRoles: Function }} options.userRoleCache Step 07
 * @param {{ getRoleDefinitions: Function }} options.roleDefinitionsCache Step 08
 * @param {{ debug: Function, warn: Function }} [options.logger]
 */
export function createCapabilityAuthorizer({
  userRoleCache,
  roleDefinitionsCache,
  logger
}) {
  function evaluate(roleIds, snapshot, capabilityId, context) {
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

    let unknownRoleCount = 0
    for (const roleId of roleIds) {
      const capabilities = capabilitiesByRole.get(roleId)
      if (!capabilities) {
        unknownRoleCount += 1
      } else if (capabilities.has(capabilityId)) {
        return Object.freeze({
          outcome: AuthorizationOutcome.ALLOWED,
          ...base,
          unknownRoleCount
        })
      }
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

  async function decide(user, capability, { correlationId, signal }) {
    if (!isAuthenticatedUserContext(user)) {
      return unavailable(UnavailableReason.UNTRUSTED_USER_CONTEXT)
    }
    if (!issuedCapabilities.has(capability)) {
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
      capabilityId,
      {
        userRoleCacheState,
        roleDefinitionsCacheState: definitions.cacheState,
        staleDefinitionsUsed: definitions.freshness === SnapshotState.STALE
      }
    )
  }

  /**
   * @param {Readonly<{ userId: string }>} user the trusted Step 04 authenticated-user context
   * @param {Readonly<{ capabilityId: string }>} capability from `createRequiredCapability`
   * @param {{ correlationId?: string, signal?: AbortSignal }} [options]
   * @returns {Promise<Readonly<{ outcome: 'allowed' | 'denied' | 'unavailable', reason?: string }>>}
   */
  async function authorize(user, capability, { correlationId, signal } = {}) {
    let decision
    try {
      decision = await decide(user, capability, { correlationId, signal })
    } catch {
      decision = unavailable(UnavailableReason.INTERNAL_FAILURE)
    }

    const entry = {
      event: 'authorization.decision',
      outcome: decision.outcome,
      reason: decision.reason,
      capability: decision.capability,
      definitionsVersion: decision.definitionsVersion,
      userRoleCacheState: decision.userRoleCacheState,
      roleDefinitionsCacheState: decision.roleDefinitionsCacheState,
      correlationId
    }
    if (decision.outcome === AuthorizationOutcome.UNAVAILABLE) {
      logger?.warn(entry, 'authorization.decision')
    } else {
      logger?.debug(entry, 'authorization.decision')
    }

    return decision
  }

  return { authorize }
}
