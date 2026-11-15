import { createAuthenticatedUserContext } from '#/authentication/entra/authenticated-user-context.js'
import {
  AuthorizationDataFailure as Failure,
  LIMITS,
  validateRoleDefinitionsResult,
  validateUserRolesResult
} from './authorization-response-validator.js'
import { UserProfileOutcome } from './user-profile-client.js'

const USER_ID = '0a1b2c3d-0000-4000-8000-00000000000a'
const SERVICE_ID = 'catch-recording'
const user = createAuthenticatedUserContext({ oid: USER_ID }, 'oid').user

const rolesBody = (overrides = {}) => ({
  schemaVersion: '1.0',
  definitionsVersion: '1',
  userId: USER_ID,
  roles: ['VRO5--Owner', 'PLDN--Skipper'],
  ...overrides
})
const definitionsBody = (overrides = {}) => ({
  schemaVersion: '1.0',
  definitionsVersion: '1',
  serviceId: SERVICE_ID,
  updatedAt: '2026-11-05T00:00:00Z',
  roles: [
    {
      roleId: 'Owner',
      capabilityIds: ['catch-record.create', 'catch-record.read']
    },
    { roleId: 'ReadOnlyUser', capabilityIds: ['catch-record.read'] }
  ],
  ...overrides
})

const transport = (body) => ({ ok: true, body })
const validationFailure = (reason) => ({
  ok: false,
  source: 'validation',
  reason
})
const userRoles = (body) => validateUserRolesResult(transport(body), user)
const definitions = (body) =>
  validateRoleDefinitionsResult(transport(body), SERVICE_ID)

describe('#validateUserRolesResult', () => {
  test('Should build an immutable model of the validated assigned roles', () => {
    const result = userRoles(rolesBody())

    expect(result).toEqual({
      ok: true,
      value: {
        userId: USER_ID,
        definitionsVersion: '1',
        roleIds: ['VRO5--Owner', 'PLDN--Skipper']
      }
    })
    expect(Object.isFrozen(result.value)).toBe(true)
    expect(Object.isFrozen(result.value.roleIds)).toBe(true)
  })

  test('Should not retain transport data that the caller could later mutate', () => {
    const body = rolesBody()
    const result = userRoles(body)

    body.roles.push('Injected')
    body.userId = 'someone-else'

    expect(result.value.roleIds).toEqual(['VRO5--Owner', 'PLDN--Skipper'])
    expect(result.value.userId).toBe(USER_ID)
  })

  test('Should accept a valid user with no roles and give them no default role', () => {
    expect(userRoles(rolesBody({ roles: [] }))).toEqual({
      ok: true,
      value: { userId: USER_ID, definitionsVersion: '1', roleIds: [] }
    })
  })

  test('Should ignore unknown extra fields without copying them', () => {
    const result = userRoles(rolesBody({ isAdmin: true, extra: { a: 1 } }))

    expect(Object.keys(result.value).sort()).toEqual([
      'definitionsVersion',
      'roleIds',
      'userId'
    ])
  })

  test.each([
    [
      'a response for another user',
      { userId: 'someone-else' },
      Failure.USER_ID_MISMATCH
    ],
    [
      'a differently-cased user id',
      { userId: USER_ID.toUpperCase() },
      Failure.USER_ID_MISMATCH
    ],
    ['a padded user id', { userId: ` ${USER_ID}` }, Failure.USER_ID_MISMATCH],
    [
      'a missing user id',
      { userId: undefined },
      Failure.MISSING_REQUIRED_FIELD
    ],
    ['a numeric user id', { userId: 7 }, Failure.WRONG_FIELD_TYPE],
    [
      'a missing schema version',
      { schemaVersion: undefined },
      Failure.MISSING_REQUIRED_FIELD
    ],
    [
      'an unknown schema version',
      { schemaVersion: '2.0' },
      Failure.UNSUPPORTED_SCHEMA_VERSION
    ],
    [
      'an empty schema version',
      { schemaVersion: '' },
      Failure.UNSUPPORTED_SCHEMA_VERSION
    ],
    [
      'a numeric schema version',
      { schemaVersion: 1 },
      Failure.WRONG_FIELD_TYPE
    ],
    [
      'a missing definitions version',
      { definitionsVersion: undefined },
      Failure.MISSING_REQUIRED_FIELD
    ],
    [
      'an empty definitions version',
      { definitionsVersion: '' },
      Failure.INVALID_DEFINITIONS_VERSION
    ],
    [
      'a numeric definitions version',
      { definitionsVersion: 1 },
      Failure.WRONG_FIELD_TYPE
    ],
    [
      'an over-long definitions version',
      { definitionsVersion: 'v'.repeat(65) },
      Failure.INVALID_DEFINITIONS_VERSION
    ],
    [
      'a malformed definitions version',
      { definitionsVersion: 'v 1' },
      Failure.INVALID_DEFINITIONS_VERSION
    ],
    ['missing roles', { roles: undefined }, Failure.MISSING_REQUIRED_FIELD],
    ['null roles', { roles: null }, Failure.WRONG_FIELD_TYPE],
    [
      'an object instead of roles',
      { roles: { a: 1 } },
      Failure.WRONG_FIELD_TYPE
    ],
    ['a non-string role', { roles: ['A', 7] }, Failure.WRONG_FIELD_TYPE],
    ['an empty role', { roles: ['A', ''] }, Failure.INVALID_ROLE_ID],
    ['a role with whitespace', { roles: [' A'] }, Failure.INVALID_ROLE_ID],
    [
      'a role with a control character',
      { roles: ['A\n'] },
      Failure.INVALID_ROLE_ID
    ],
    [
      'a role with a path separator',
      { roles: ['A/B'] },
      Failure.INVALID_ROLE_ID
    ],
    [
      'an over-long role',
      { roles: ['A'.repeat(129)] },
      Failure.IDENTIFIER_TOO_LONG
    ],
    ['a duplicate role', { roles: ['A', 'B', 'A'] }, Failure.DUPLICATE_ROLE_ID],
    [
      'too many roles',
      {
        roles: Array.from(
          { length: LIMITS.maxUserRoles + 1 },
          (_, i) => `R${i}`
        )
      },
      Failure.COLLECTION_LIMIT_EXCEEDED
    ]
  ])('Should reject %s', (_name, overrides, reason) => {
    expect(userRoles(rolesBody(overrides))).toEqual(validationFailure(reason))
  })

  test('Should reject a role differing only by case as a distinct, not duplicate, role', () => {
    expect(userRoles(rolesBody({ roles: ['Owner', 'owner'] })).ok).toBe(true)
  })

  test('Should accept the maximum number of roles', () => {
    const roles = Array.from({ length: LIMITS.maxUserRoles }, (_, i) => `R${i}`)

    expect(userRoles(rolesBody({ roles })).ok).toBe(true)
  })

  test.each([[null], [[]], ['text'], [7]])(
    'Should reject the non-object root %j',
    (body) => {
      expect(userRoles(body)).toEqual(
        validationFailure(Failure.WRONG_FIELD_TYPE)
      )
    }
  )

  test('Should never turn an invalid response into an empty role set', () => {
    const result = userRoles(rolesBody({ roles: 'none' }))

    expect(result.ok).toBe(false)
    expect(result).not.toHaveProperty('value')
  })

  test.each([[null], [{ userId: USER_ID }], ['id'], [undefined]])(
    'Should refuse to validate for the untrusted user %j',
    (untrusted) => {
      expect(
        validateUserRolesResult(transport(rolesBody()), untrusted)
      ).toEqual(validationFailure(Failure.UNEXPECTED_VALIDATION_FAILURE))
    }
  )

  test('Should preserve a transport failure as a typed dependency failure without validating', () => {
    expect(
      validateUserRolesResult(
        { ok: false, outcome: UserProfileOutcome.UNAVAILABLE, status: 503 },
        user
      )
    ).toEqual({
      ok: false,
      source: 'dependency',
      outcome: UserProfileOutcome.UNAVAILABLE,
      status: 503
    })
  })

  test('Should keep a not-found transport outcome a dependency failure, never an unknown user or a role', () => {
    const result = validateUserRolesResult(
      { ok: false, outcome: UserProfileOutcome.NOT_FOUND, status: 404 },
      user
    )

    expect(result).toMatchObject({ ok: false, source: 'dependency' })
    expect(result).not.toHaveProperty('value')
  })

  test('Should not leak the response body or user id into a failure', () => {
    const result = userRoles(rolesBody({ roles: ['Secret/Role'] }))

    expect(JSON.stringify(result)).not.toMatch(/Secret|0000/)
  })
})

describe('#validateRoleDefinitionsResult', () => {
  test('Should build an immutable model of the validated definitions', () => {
    const result = definitions(definitionsBody())

    expect(result).toEqual({
      ok: true,
      value: {
        serviceId: SERVICE_ID,
        definitionsVersion: '1',
        updatedAt: '2026-11-05T00:00:00.000Z',
        roles: [
          {
            roleId: 'Owner',
            capabilityIds: ['catch-record.create', 'catch-record.read']
          },
          { roleId: 'ReadOnlyUser', capabilityIds: ['catch-record.read'] }
        ]
      }
    })
    expect(Object.isFrozen(result.value)).toBe(true)
    expect(Object.isFrozen(result.value.roles)).toBe(true)
    expect(Object.isFrozen(result.value.roles[0])).toBe(true)
    expect(Object.isFrozen(result.value.roles[0].capabilityIds)).toBe(true)
  })

  test('Should not retain transport data that the caller could later mutate', () => {
    const body = definitionsBody()
    const result = definitions(body)

    body.roles[0].capabilityIds.push('catch-record.admin')
    body.roles.push({ roleId: 'Injected', capabilityIds: [] })

    expect(result.value.roles).toHaveLength(2)
    expect(result.value.roles[0].capabilityIds).not.toContain(
      'catch-record.admin'
    )
  })

  test('Should treat a missing updatedAt as absent rather than inventing one', () => {
    const body = definitionsBody()
    delete body.updatedAt

    expect(definitions(body).value.updatedAt).toBeNull()
  })

  test('Should accept a role with no capabilities that grants nothing', () => {
    const result = definitions(
      definitionsBody({ roles: [{ roleId: 'Observer', capabilityIds: [] }] })
    )

    expect(result.value.roles).toEqual([
      { roleId: 'Observer', capabilityIds: [] }
    ])
  })

  test.each([
    [
      'another service',
      { serviceId: 'other-service' },
      Failure.SERVICE_ID_MISMATCH
    ],
    [
      'a differently-cased service id',
      { serviceId: 'Catch-Recording' },
      Failure.SERVICE_ID_MISMATCH
    ],
    [
      'a missing service id',
      { serviceId: undefined },
      Failure.MISSING_REQUIRED_FIELD
    ],
    [
      'an unknown schema version',
      { schemaVersion: '1.1' },
      Failure.UNSUPPORTED_SCHEMA_VERSION
    ],
    [
      'a missing definitions version',
      { definitionsVersion: undefined },
      Failure.MISSING_REQUIRED_FIELD
    ],
    [
      'an empty definitions version',
      { definitionsVersion: '' },
      Failure.INVALID_DEFINITIONS_VERSION
    ],
    [
      'an invalid timestamp',
      { updatedAt: 'yesterday' },
      Failure.INVALID_TIMESTAMP
    ],
    [
      'a local timestamp',
      { updatedAt: '2026-11-05T00:00:00' },
      Failure.INVALID_TIMESTAMP
    ],
    [
      'an offset timestamp',
      { updatedAt: '2026-11-05T00:00:00+01:00' },
      Failure.INVALID_TIMESTAMP
    ],
    [
      'an impossible calendar date',
      { updatedAt: '2026-02-31T00:00:00Z' },
      Failure.INVALID_TIMESTAMP
    ],
    [
      'an out-of-range month',
      { updatedAt: '2026-13-01T00:00:00Z' },
      Failure.INVALID_TIMESTAMP
    ],
    [
      'a numeric timestamp',
      { updatedAt: 1762300800 },
      Failure.INVALID_TIMESTAMP
    ],
    ['missing roles', { roles: undefined }, Failure.MISSING_REQUIRED_FIELD],
    ['non-array roles', { roles: {} }, Failure.WRONG_FIELD_TYPE],
    ['empty role definitions', { roles: [] }, Failure.EMPTY_ROLE_DEFINITIONS],
    ['a non-object definition', { roles: ['Owner'] }, Failure.WRONG_FIELD_TYPE],
    [
      'a definition without a role id',
      { roles: [{ capabilityIds: [] }] },
      Failure.MISSING_REQUIRED_FIELD
    ],
    [
      'an invalid role id',
      { roles: [{ roleId: 'a b', capabilityIds: [] }] },
      Failure.INVALID_ROLE_ID
    ],
    [
      'a numeric role id',
      { roles: [{ roleId: 5, capabilityIds: [] }] },
      Failure.WRONG_FIELD_TYPE
    ],
    [
      'an over-long role id',
      { roles: [{ roleId: 'R'.repeat(129), capabilityIds: [] }] },
      Failure.IDENTIFIER_TOO_LONG
    ],
    [
      'a duplicate role definition',
      {
        roles: [
          { roleId: 'A', capabilityIds: [] },
          { roleId: 'A', capabilityIds: [] }
        ]
      },
      Failure.DUPLICATE_ROLE_ID
    ],
    [
      'missing capabilities',
      { roles: [{ roleId: 'A' }] },
      Failure.MISSING_REQUIRED_FIELD
    ],
    [
      'non-array capabilities',
      { roles: [{ roleId: 'A', capabilityIds: 'x' }] },
      Failure.WRONG_FIELD_TYPE
    ],
    [
      'a non-string capability',
      { roles: [{ roleId: 'A', capabilityIds: [7] }] },
      Failure.WRONG_FIELD_TYPE
    ],
    [
      'an invalid capability',
      { roles: [{ roleId: 'A', capabilityIds: ['*'] }] },
      Failure.INVALID_CAPABILITY_ID
    ],
    [
      'a wildcard capability',
      { roles: [{ roleId: 'A', capabilityIds: ['catch-record.*'] }] },
      Failure.INVALID_CAPABILITY_ID
    ],
    [
      'an empty capability',
      { roles: [{ roleId: 'A', capabilityIds: [''] }] },
      Failure.INVALID_CAPABILITY_ID
    ],
    [
      'an over-long capability',
      { roles: [{ roleId: 'A', capabilityIds: ['c'.repeat(129)] }] },
      Failure.IDENTIFIER_TOO_LONG
    ],
    [
      'a duplicate capability within a role',
      { roles: [{ roleId: 'A', capabilityIds: ['x.y', 'x.y'] }] },
      Failure.DUPLICATE_CAPABILITY_ID
    ],
    [
      'too many role definitions',
      {
        roles: Array.from(
          { length: LIMITS.maxRoleDefinitions + 1 },
          (_, i) => ({ roleId: `R${i}`, capabilityIds: [] })
        )
      },
      Failure.COLLECTION_LIMIT_EXCEEDED
    ],
    [
      'too many capabilities in a role',
      {
        roles: [
          {
            roleId: 'A',
            capabilityIds: Array.from(
              { length: LIMITS.maxCapabilitiesPerRole + 1 },
              (_, i) => `c.${i}`
            )
          }
        ]
      },
      Failure.COLLECTION_LIMIT_EXCEEDED
    ],
    [
      'too many total associations',
      {
        roles: Array.from({ length: 21 }, (_, r) => ({
          roleId: `R${r}`,
          capabilityIds: Array.from({ length: 100 }, (_, c) => `c.${c}`)
        }))
      },
      Failure.COLLECTION_LIMIT_EXCEEDED
    ]
  ])('Should reject %s', (_name, overrides, reason) => {
    expect(definitions(definitionsBody(overrides))).toEqual(
      validationFailure(reason)
    )
  })

  test('Should accept the same capability in different roles', () => {
    expect(
      definitions(
        definitionsBody({
          roles: [
            { roleId: 'A', capabilityIds: ['x.y'] },
            { roleId: 'B', capabilityIds: ['x.y'] }
          ]
        })
      ).ok
    ).toBe(true)
  })

  test.each([[null], [[]], ['text']])(
    'Should reject the non-object root %j',
    (body) => {
      expect(definitions(body)).toEqual(
        validationFailure(Failure.WRONG_FIELD_TYPE)
      )
    }
  )

  test('Should never turn an invalid or dependency-failed response into empty or permissive definitions', () => {
    expect(definitions(definitionsBody({ roles: [] }))).not.toHaveProperty(
      'value'
    )
    expect(
      validateRoleDefinitionsResult(
        { ok: false, outcome: UserProfileOutcome.TIMEOUT, status: null },
        SERVICE_ID
      )
    ).toEqual({
      ok: false,
      source: 'dependency',
      outcome: UserProfileOutcome.TIMEOUT,
      status: null
    })
  })

  test.each([[undefined], [null]])(
    'Should report a missing transport result (%j) as an unexpected validation failure',
    (missing) => {
      expect(validateRoleDefinitionsResult(missing, SERVICE_ID)).toEqual(
        validationFailure(Failure.UNEXPECTED_VALIDATION_FAILURE)
      )
    }
  )

  test('Should report an unexpected internal error safely', () => {
    const hostile = {
      ok: true,
      get body() {
        throw new Error('boom')
      }
    }

    expect(validateRoleDefinitionsResult(hostile, SERVICE_ID)).toEqual(
      validationFailure(Failure.UNEXPECTED_VALIDATION_FAILURE)
    )
  })
})
