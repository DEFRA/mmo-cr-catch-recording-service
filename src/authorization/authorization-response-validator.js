import { isAuthenticatedUserContext } from '#/authentication/entra/authenticated-user-context.js'

// Explicit allow-list: an unknown (including a newer) schema version is never accepted optimistically
export const SUPPORTED_SCHEMA_VERSIONS = Object.freeze(['1.0'])

// Conservative semantic bounds. A user's roles may be vessel-scoped, so the user-role bound is generous;
// transport size is bounded separately by the client.
export const LIMITS = Object.freeze({
  maxUserRoles: 1000,
  maxRoleDefinitions: 200,
  maxCapabilitiesPerRole: 100,
  maxRoleCapabilityAssociations: 2000,
  maxIdentifierLength: 128,
  maxVersionLength: 64
})

const IDENTIFIER_FORMAT = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/
const VERSION_FORMAT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const UTC_INSTANT_FORMAT =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/

/**
 * Typed validation failures. None is an API status and none carries any part of the response body.
 */
export const AuthorizationDataFailure = Object.freeze({
  MISSING_REQUIRED_FIELD: 'MISSING_REQUIRED_FIELD',
  WRONG_FIELD_TYPE: 'WRONG_FIELD_TYPE',
  UNSUPPORTED_SCHEMA_VERSION: 'UNSUPPORTED_SCHEMA_VERSION',
  USER_ID_MISMATCH: 'USER_ID_MISMATCH',
  SERVICE_ID_MISMATCH: 'SERVICE_ID_MISMATCH',
  INVALID_ROLE_ID: 'INVALID_ROLE_ID',
  DUPLICATE_ROLE_ID: 'DUPLICATE_ROLE_ID',
  INVALID_CAPABILITY_ID: 'INVALID_CAPABILITY_ID',
  DUPLICATE_CAPABILITY_ID: 'DUPLICATE_CAPABILITY_ID',
  INVALID_DEFINITIONS_VERSION: 'INVALID_DEFINITIONS_VERSION',
  INVALID_TIMESTAMP: 'INVALID_TIMESTAMP',
  IDENTIFIER_TOO_LONG: 'IDENTIFIER_TOO_LONG',
  COLLECTION_LIMIT_EXCEEDED: 'COLLECTION_LIMIT_EXCEEDED',
  EMPTY_ROLE_DEFINITIONS: 'EMPTY_ROLE_DEFINITIONS',
  UNEXPECTED_VALIDATION_FAILURE: 'UNEXPECTED_VALIDATION_FAILURE'
})

const FAILURE = AuthorizationDataFailure

/** Raised internally to stop validation at the first problem; never escapes this module. */
class ValidationFailure extends Error {
  constructor(reason) {
    super(reason)
    this.reason = reason
  }
}

const reject = (reason) => {
  throw new ValidationFailure(reason)
}

const isPlainObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

function requireField(source, name) {
  if (!Object.hasOwn(source, name) || source[name] === undefined) {
    reject(FAILURE.MISSING_REQUIRED_FIELD)
  }
  return source[name]
}

function requireString(source, name) {
  const value = requireField(source, name)
  if (typeof value !== 'string') {
    reject(FAILURE.WRONG_FIELD_TYPE)
  }
  return value
}

function requireArray(source, name, maximum) {
  const value = requireField(source, name)
  if (!Array.isArray(value)) {
    reject(FAILURE.WRONG_FIELD_TYPE)
  }
  if (value.length > maximum) {
    reject(FAILURE.COLLECTION_LIMIT_EXCEEDED)
  }
  return value
}

function validateSchemaVersion(body) {
  if (
    !SUPPORTED_SCHEMA_VERSIONS.includes(requireString(body, 'schemaVersion'))
  ) {
    reject(FAILURE.UNSUPPORTED_SCHEMA_VERSION)
  }
}

function validateDefinitionsVersion(body) {
  const version = requireString(body, 'definitionsVersion')
  if (
    version.length > LIMITS.maxVersionLength ||
    !VERSION_FORMAT.test(version)
  ) {
    reject(FAILURE.INVALID_DEFINITIONS_VERSION)
  }
  return version
}

function validateIdentifier(value, invalidReason) {
  if (typeof value !== 'string') {
    reject(FAILURE.WRONG_FIELD_TYPE)
  }
  if (value.length > LIMITS.maxIdentifierLength) {
    reject(FAILURE.IDENTIFIER_TOO_LONG)
  }
  if (!IDENTIFIER_FORMAT.test(value)) {
    reject(invalidReason)
  }
  return value
}

function validateUniqueIdentifiers(values, invalidReason, duplicateReason) {
  const seen = new Set()
  for (const value of values) {
    validateIdentifier(value, invalidReason)
    if (seen.has(value)) {
      reject(duplicateReason)
    }
    seen.add(value)
  }
  return Object.freeze([...values])
}

function validateInstant(value) {
  if (
    typeof value !== 'string' ||
    !UTC_INSTANT_FORMAT.test(value) ||
    Number.isNaN(Date.parse(value))
  ) {
    reject(FAILURE.INVALID_TIMESTAMP)
  }
  // Round-trip rejects impossible calendar dates such as 2026-02-31 that Date.parse would roll over
  const instant = new Date(value)
  if (instant.toISOString().slice(0, 10) !== value.slice(0, 10)) {
    reject(FAILURE.INVALID_TIMESTAMP)
  }
  return instant.toISOString()
}

function validateRoleDefinition(definition, state) {
  if (!isPlainObject(definition)) {
    reject(FAILURE.WRONG_FIELD_TYPE)
  }

  const roleId = validateIdentifier(
    requireField(definition, 'roleId'),
    FAILURE.INVALID_ROLE_ID
  )
  if (state.roleIds.has(roleId)) {
    reject(FAILURE.DUPLICATE_ROLE_ID)
  }
  state.roleIds.add(roleId)

  const capabilities = requireArray(
    definition,
    'capabilityIds',
    LIMITS.maxCapabilitiesPerRole
  )
  state.associations += capabilities.length
  if (state.associations > LIMITS.maxRoleCapabilityAssociations) {
    reject(FAILURE.COLLECTION_LIMIT_EXCEEDED)
  }

  return Object.freeze({
    roleId,
    capabilityIds: validateUniqueIdentifiers(
      capabilities,
      FAILURE.INVALID_CAPABILITY_ID,
      FAILURE.DUPLICATE_CAPABILITY_ID
    )
  })
}

function parseUserRoles(body, trustedUser) {
  if (!isPlainObject(body)) {
    reject(FAILURE.WRONG_FIELD_TYPE)
  }

  validateSchemaVersion(body)
  if (requireString(body, 'userId') !== trustedUser.userId) {
    reject(FAILURE.USER_ID_MISMATCH)
  }
  const definitionsVersion = validateDefinitionsVersion(body)
  const roles = requireArray(body, 'roles', LIMITS.maxUserRoles)

  return Object.freeze({
    userId: trustedUser.userId,
    definitionsVersion,
    roleIds: validateUniqueIdentifiers(
      roles,
      FAILURE.INVALID_ROLE_ID,
      FAILURE.DUPLICATE_ROLE_ID
    )
  })
}

function parseRoleDefinitions(body, serviceId) {
  if (!isPlainObject(body)) {
    reject(FAILURE.WRONG_FIELD_TYPE)
  }

  validateSchemaVersion(body)
  if (requireString(body, 'serviceId') !== serviceId) {
    reject(FAILURE.SERVICE_ID_MISMATCH)
  }
  const definitionsVersion = validateDefinitionsVersion(body)
  const updatedAt = Object.hasOwn(body, 'updatedAt')
    ? validateInstant(body.updatedAt)
    : null

  const definitions = requireArray(body, 'roles', LIMITS.maxRoleDefinitions)
  if (definitions.length === 0) {
    // An empty set grants nothing, but it is never accepted as a usable snapshot: an unexpectedly empty
    // body must not replace a valid one, and it must never be mistaken for unrestricted access.
    reject(FAILURE.EMPTY_ROLE_DEFINITIONS)
  }

  const state = { roleIds: new Set(), associations: 0 }

  return Object.freeze({
    serviceId,
    definitionsVersion,
    updatedAt,
    roles: Object.freeze(
      definitions.map((definition) => validateRoleDefinition(definition, state))
    )
  })
}

const validationFailure = (reason) =>
  Object.freeze({ ok: false, source: 'validation', reason })

function dependencyFailure(transportResult) {
  return Object.freeze({
    ok: false,
    source: 'dependency',
    outcome: transportResult.outcome,
    status: transportResult.status
  })
}

function validate(transportResult, parse) {
  if (!transportResult?.ok) {
    return transportResult
      ? dependencyFailure(transportResult)
      : validationFailure(FAILURE.UNEXPECTED_VALIDATION_FAILURE)
  }

  try {
    return Object.freeze({ ok: true, value: parse(transportResult.body) })
  } catch (error) {
    return validationFailure(
      error instanceof ValidationFailure
        ? error.reason
        : FAILURE.UNEXPECTED_VALIDATION_FAILURE
    )
  }
}

/**
 * Validates a Step 05 user-roles result for the trusted user it was requested for. A transport failure is
 * passed through as a typed dependency failure; an invalid body is a typed validation failure and is never
 * turned into an empty role set. A valid response with no roles (the contract's representation of an
 * unknown user) is a valid outcome whose model grants no role - never a default one.
 *
 * @param {{ ok: boolean, body?: unknown }} transportResult
 * @param {Readonly<{ userId: string }>} trustedUser the Step 04 context the request was made for
 * @returns {{ ok: true, value: Readonly<{ userId: string, definitionsVersion: string, roleIds: ReadonlyArray<string> }> }
 *   | { ok: false, source: 'dependency', outcome: string, status: number | null }
 *   | { ok: false, source: 'validation', reason: string }}
 */
export function validateUserRolesResult(transportResult, trustedUser) {
  if (!isAuthenticatedUserContext(trustedUser)) {
    return validationFailure(FAILURE.UNEXPECTED_VALIDATION_FAILURE)
  }

  return validate(transportResult, (body) => parseUserRoles(body, trustedUser))
}

/**
 * Validates a Step 05 role-definitions result for the configured service. Dependency and validation
 * failures stay distinct and no failure ever becomes an empty or permissive definitions model.
 *
 * @param {{ ok: boolean, body?: unknown }} transportResult
 * @param {string} serviceId the configured `authorization.serviceId`
 * @returns {{ ok: true, value: Readonly<{ serviceId: string, definitionsVersion: string, updatedAt: string | null,
 *   roles: ReadonlyArray<Readonly<{ roleId: string, capabilityIds: ReadonlyArray<string> }>> }> }
 *   | { ok: false, source: 'dependency', outcome: string, status: number | null }
 *   | { ok: false, source: 'validation', reason: string }}
 */
export function validateRoleDefinitionsResult(transportResult, serviceId) {
  return validate(transportResult, (body) =>
    parseRoleDefinitions(body, serviceId)
  )
}
