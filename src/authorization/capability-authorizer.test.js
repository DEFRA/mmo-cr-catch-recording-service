import { vi } from 'vitest'

import { createAuthenticatedUserContext } from '#/authentication/entra/authenticated-user-context.js'
import { AuthorizationDataFailure } from './authorization-response-validator.js'
import {
  AuthorizationOutcome,
  createCapabilityAuthorizer,
  createRequiredCapability,
  DenialReason,
  UnavailableReason
} from './capability-authorizer.js'
import { SnapshotState } from './role-definitions-cache.js'
import { UserProfileOutcome } from './user-profile-client.js'

const user = createAuthenticatedUserContext({ oid: 'user-a' }, 'oid').user
const READ = createRequiredCapability('catch-record.read')
const CREATE = createRequiredCapability('catch-record.create')
const UPDATE = createRequiredCapability('catch-record.update')

const DEFINITIONS = Object.freeze({
  serviceId: 'catch-recording',
  definitionsVersion: '7',
  updatedAt: null,
  roles: Object.freeze([
    Object.freeze({
      roleId: 'Owner',
      capabilityIds: Object.freeze(['catch-record.create', 'catch-record.read'])
    }),
    Object.freeze({
      roleId: 'ReadOnlyUser',
      capabilityIds: Object.freeze(['catch-record.read'])
    }),
    Object.freeze({ roleId: 'Observer', capabilityIds: Object.freeze([]) })
  ])
})

const rolesResult = (roleIds, cacheState = 'hit') => ({
  ok: true,
  value: { userId: 'user-a', definitionsVersion: '7', roleIds },
  cacheState
})
const definitionsResult = (overrides = {}) => ({
  ok: true,
  snapshot: DEFINITIONS,
  freshness: SnapshotState.FRESH,
  cacheState: 'hit',
  ...overrides
})
const dependencyFailure = (outcome) => ({
  ok: false,
  source: 'dependency',
  outcome,
  status: null
})

function createHarness({ roles, definitions } = {}) {
  const userRoleCache = {
    getUserRoles: vi.fn(async () => roles ?? rolesResult(['Owner']))
  }
  const roleDefinitionsCache = {
    getRoleDefinitions: vi.fn(async () => definitions ?? definitionsResult())
  }
  const logger = { debug: vi.fn(), warn: vi.fn() }
  const authorizer = createCapabilityAuthorizer({
    userRoleCache,
    roleDefinitionsCache,
    logger
  })

  return { authorizer, userRoleCache, roleDefinitionsCache, logger }
}

const decide = (harness, capability = READ, options) =>
  harness.authorizer.authorize(user, capability, options)

describe('#createRequiredCapability', () => {
  test('Should create an immutable exact capability', () => {
    const capability = createRequiredCapability('catch-record.read')

    expect(capability).toEqual({ capabilityId: 'catch-record.read' })
    expect(Object.isFrozen(capability)).toBe(true)
  })

  test.each([
    [''],
    [' '],
    [' catch-record.read'],
    ['catch-record.*'],
    [null],
    [undefined],
    [7],
    ['a'.repeat(129)]
  ])('Should reject the invalid capability %j', (value) => {
    expect(() => createRequiredCapability(value)).toThrow(TypeError)
  })
})

describe('#createCapabilityAuthorizer', () => {
  describe('any-role-grants', () => {
    test('Should allow when a single assigned role grants the exact capability', async () => {
      const harness = createHarness({ roles: rolesResult(['ReadOnlyUser']) })

      await expect(decide(harness, READ)).resolves.toMatchObject({
        outcome: AuthorizationOutcome.ALLOWED,
        capability: 'catch-record.read',
        definitionsVersion: '7',
        userRoleCacheState: 'hit',
        roleDefinitionsCacheState: 'hit',
        staleDefinitionsUsed: false,
        unknownRoleCount: 0
      })
    })

    test('Should deny when a known role does not grant the capability', async () => {
      const harness = createHarness({ roles: rolesResult(['ReadOnlyUser']) })

      await expect(decide(harness, CREATE)).resolves.toMatchObject({
        outcome: AuthorizationOutcome.DENIED,
        reason: DenialReason.CAPABILITY_NOT_GRANTED
      })
    })

    test('Should allow when at least one of several roles grants it, whatever the order', async () => {
      for (const roles of [
        ['ReadOnlyUser', 'Owner'],
        ['Owner', 'ReadOnlyUser'],
        ['Observer', 'ReadOnlyUser', 'Owner']
      ]) {
        const harness = createHarness({ roles: rolesResult(roles) })
        expect((await decide(harness, CREATE)).outcome).toBe(
          AuthorizationOutcome.ALLOWED
        )
      }
    })

    test('Should not require every role to grant the capability', async () => {
      const harness = createHarness({
        roles: rolesResult(['Observer', 'Owner', 'ReadOnlyUser'])
      })

      expect((await decide(harness, READ)).outcome).toBe(
        AuthorizationOutcome.ALLOWED
      )
    })

    test.each([
      ['catch-record.read', 'catch-record.create'],
      ['catch-record.read', 'catch-record.update'],
      ['catch-record.create', 'catch-record.read']
    ])(
      'Should not let %s imply a different capability',
      async (granted, required) => {
        const harness = createHarness({
          roles: rolesResult(['Narrow']),
          definitions: definitionsResult({
            snapshot: Object.freeze({
              ...DEFINITIONS,
              roles: Object.freeze([
                Object.freeze({
                  roleId: 'Narrow',
                  capabilityIds: Object.freeze([granted])
                }),
                Object.freeze({
                  roleId: 'Other',
                  capabilityIds: Object.freeze([required])
                })
              ])
            })
          })
        })

        expect(
          (await decide(harness, createRequiredCapability(required))).outcome
        ).toBe(AuthorizationOutcome.DENIED)
      }
    )

    test.each([
      ['catch-record'],
      ['catch-record.rea'],
      ['catch-record.read2'],
      ['Catch-Record.Read']
    ])(
      'Should use exact matching only and never prefix, suffix, case or similarity matches (%s)',
      async (required) => {
        const harness = createHarness({ roles: rolesResult(['ReadOnlyUser']) })

        expect(
          (await decide(harness, createRequiredCapability(required))).reason
        ).toBe(DenialReason.REQUIRED_CAPABILITY_UNKNOWN)
      }
    )

    test('Should not treat a wildcard-looking capability in the definitions as granting anything else', async () => {
      const harness = createHarness({
        roles: rolesResult(['Wild']),
        definitions: definitionsResult({
          snapshot: Object.freeze({
            ...DEFINITIONS,
            roles: Object.freeze([
              Object.freeze({
                roleId: 'Wild',
                capabilityIds: Object.freeze(['catch-record.x'])
              })
            ])
          })
        })
      })

      expect((await decide(harness, READ)).reason).toBe(
        DenialReason.REQUIRED_CAPABILITY_UNKNOWN
      )
    })
  })

  describe('unknown roles, capabilities, users', () => {
    test('Should deny when every assigned role is unknown', async () => {
      const harness = createHarness({
        roles: rolesResult(['Ghost', 'Phantom'])
      })

      await expect(decide(harness, READ)).resolves.toMatchObject({
        outcome: AuthorizationOutcome.DENIED,
        reason: DenialReason.ALL_ASSIGNED_ROLES_UNKNOWN,
        unknownRoleCount: 2
      })
    })

    test('Should not let an unknown role block a grant from a known role', async () => {
      const harness = createHarness({ roles: rolesResult(['Ghost', 'Owner']) })

      await expect(decide(harness, READ)).resolves.toMatchObject({
        outcome: AuthorizationOutcome.ALLOWED,
        unknownRoleCount: 1
      })
    })

    test('Should deny an unknown required capability even for a role that grants others', async () => {
      const harness = createHarness({ roles: rolesResult(['Owner']) })

      await expect(
        decide(harness, createRequiredCapability('catch-record.amend'))
      ).resolves.toMatchObject({
        outcome: AuthorizationOutcome.DENIED,
        reason: DenialReason.REQUIRED_CAPABILITY_UNKNOWN
      })
    })

    test('Should deny a user with no roles without loading definitions or inventing a role', async () => {
      const harness = createHarness({ roles: rolesResult([], 'refreshed') })

      await expect(decide(harness, READ)).resolves.toMatchObject({
        outcome: AuthorizationOutcome.DENIED,
        reason: DenialReason.NO_ASSIGNED_ROLES,
        userRoleCacheState: 'refreshed'
      })
      expect(
        harness.roleDefinitionsCache.getRoleDefinitions
      ).not.toHaveBeenCalled()
    })
  })

  describe('unavailable authorization data', () => {
    test.each([
      [
        'a user-role dependency failure',
        dependencyFailure(UserProfileOutcome.UNAVAILABLE),
        UnavailableReason.USER_ROLES_UNAVAILABLE
      ],
      [
        'a user-role timeout',
        dependencyFailure(UserProfileOutcome.TIMEOUT),
        UnavailableReason.USER_ROLES_UNAVAILABLE
      ],
      [
        'a transport not-found',
        dependencyFailure(UserProfileOutcome.NOT_FOUND),
        UnavailableReason.USER_ROLES_UNAVAILABLE
      ],
      [
        'an unexpected cache failure',
        { ok: false, source: 'cache', reason: 'UNEXPECTED_CACHE_FAILURE' },
        UnavailableReason.USER_ROLES_UNAVAILABLE
      ],
      [
        'invalid user-role data',
        {
          ok: false,
          source: 'validation',
          reason: AuthorizationDataFailure.USER_ID_MISMATCH
        },
        UnavailableReason.AUTHORIZATION_DATA_INVALID
      ],
      [
        'caller cancellation',
        dependencyFailure(UserProfileOutcome.CANCELLED),
        UnavailableReason.CANCELLED
      ]
    ])(
      'Should be unavailable, never denied or allowed, for %s',
      async (_name, failure, reason) => {
        const harness = createHarness({ roles: failure })

        const decision = await decide(harness, READ)

        expect(decision).toMatchObject({
          outcome: AuthorizationOutcome.UNAVAILABLE,
          reason
        })
        expect(
          harness.roleDefinitionsCache.getRoleDefinitions
        ).not.toHaveBeenCalled()
      }
    )

    test.each([
      [
        'absent with a failed load',
        {
          ...dependencyFailure(UserProfileOutcome.UNAVAILABLE),
          snapshotState: SnapshotState.ABSENT
        },
        UnavailableReason.ROLE_DEFINITIONS_UNAVAILABLE
      ],
      [
        'over-stale with a failed refresh',
        {
          ...dependencyFailure(UserProfileOutcome.UNAVAILABLE),
          snapshotState: SnapshotState.OVER_STALE
        },
        UnavailableReason.ROLE_DEFINITIONS_OVER_STALE
      ],
      [
        'invalid',
        {
          ok: false,
          source: 'validation',
          reason: AuthorizationDataFailure.EMPTY_ROLE_DEFINITIONS,
          snapshotState: SnapshotState.ABSENT
        },
        UnavailableReason.AUTHORIZATION_DATA_INVALID
      ],
      [
        'an unexpected cache failure',
        { ok: false, source: 'cache', reason: 'UNEXPECTED_CACHE_FAILURE' },
        UnavailableReason.ROLE_DEFINITIONS_UNAVAILABLE
      ],
      [
        'cancelled',
        dependencyFailure(UserProfileOutcome.CANCELLED),
        UnavailableReason.CANCELLED
      ]
    ])(
      'Should be unavailable when the role definitions are %s',
      async (_name, failure, reason) => {
        const harness = createHarness({ definitions: failure })

        await expect(decide(harness, READ)).resolves.toMatchObject({
          outcome: AuthorizationOutcome.UNAVAILABLE,
          reason
        })
      }
    )

    test('Should carry only safe failure detail', async () => {
      const harness = createHarness({
        roles: dependencyFailure(UserProfileOutcome.UNAVAILABLE)
      })

      const decision = await decide(harness, READ)

      expect(decision.detail).toEqual({
        source: 'dependency',
        outcome: UserProfileOutcome.UNAVAILABLE
      })
    })

    test('Should fail closed with an internal failure when a cache throws', async () => {
      const harness = createHarness()
      harness.userRoleCache.getUserRoles.mockRejectedValue(new Error('boom'))

      await expect(decide(harness, READ)).resolves.toMatchObject({
        outcome: AuthorizationOutcome.UNAVAILABLE,
        reason: UnavailableReason.INTERNAL_FAILURE
      })
    })

    test.each([[null], [undefined], [{ userId: 'user-a' }], ['user-a']])(
      'Should fail closed for the untrusted user %j without reading any data',
      async (untrusted) => {
        const harness = createHarness()

        await expect(
          harness.authorizer.authorize(untrusted, READ)
        ).resolves.toMatchObject({
          outcome: AuthorizationOutcome.UNAVAILABLE,
          reason: UnavailableReason.UNTRUSTED_USER_CONTEXT
        })
        expect(harness.userRoleCache.getUserRoles).not.toHaveBeenCalled()
      }
    )

    test.each([
      [null],
      [undefined],
      ['catch-record.read'],
      [{ capabilityId: 'catch-record.read' }]
    ])(
      'Should fail closed for the non-issued required capability %j',
      async (capability) => {
        const harness = createHarness()

        await expect(
          harness.authorizer.authorize(user, capability)
        ).resolves.toMatchObject({
          outcome: AuthorizationOutcome.UNAVAILABLE,
          reason: UnavailableReason.INVALID_REQUIRED_CAPABILITY
        })
        expect(harness.userRoleCache.getUserRoles).not.toHaveBeenCalled()
      }
    )
  })

  describe('cache states and contracts', () => {
    test('Should use permitted stale definitions, marking the decision, without triggering anything else', async () => {
      const harness = createHarness({
        definitions: definitionsResult({
          freshness: SnapshotState.STALE,
          cacheState: 'stale-used'
        })
      })

      await expect(decide(harness, READ)).resolves.toMatchObject({
        outcome: AuthorizationOutcome.ALLOWED,
        staleDefinitionsUsed: true,
        roleDefinitionsCacheState: 'stale-used'
      })
      expect(
        harness.roleDefinitionsCache.getRoleDefinitions
      ).toHaveBeenCalledTimes(1)
    })

    test('Should pass the correlation id and cancellation signal to both caches', async () => {
      const harness = createHarness()
      const controller = new AbortController()

      await decide(harness, READ, {
        correlationId: 'corr-1',
        signal: controller.signal
      })

      const expected = { correlationId: 'corr-1', signal: controller.signal }
      expect(harness.userRoleCache.getUserRoles).toHaveBeenCalledWith(
        user,
        expected
      )
      expect(
        harness.roleDefinitionsCache.getRoleDefinitions
      ).toHaveBeenCalledWith(expected)
    })

    test('Should evaluate repeated decisions over the same snapshot consistently', async () => {
      const harness = createHarness({ roles: rolesResult(['ReadOnlyUser']) })

      const results = [
        await decide(harness, READ),
        await decide(harness, READ),
        await decide(harness, UPDATE)
      ]

      expect(results.map((result) => result.outcome)).toEqual([
        AuthorizationOutcome.ALLOWED,
        AuthorizationOutcome.ALLOWED,
        AuthorizationOutcome.DENIED
      ])
    })

    test('Should never mutate the cache results it consumes', async () => {
      const roles = rolesResult(['Owner'])
      const harness = createHarness({ roles })

      await decide(harness, READ)

      expect(Object.isFrozen(DEFINITIONS.roles)).toBe(true)
      expect(roles.value.roleIds).toEqual(['Owner'])
    })

    test('Should return immutable decisions', async () => {
      const harness = createHarness()

      expect(Object.isFrozen(await decide(harness, READ))).toBe(true)
      expect(Object.isFrozen(await decide(harness, UPDATE))).toBe(true)
    })
  })

  describe('logging and privacy', () => {
    test('Should log the safe decision facts without identity, roles or the capability map', async () => {
      const harness = createHarness({
        roles: rolesResult(['Owner', 'Secret-Role'])
      })

      await decide(harness, READ, { correlationId: 'corr-9' })
      harness.userRoleCache.getUserRoles.mockResolvedValue(
        dependencyFailure(UserProfileOutcome.TIMEOUT)
      )
      await decide(harness, READ)

      const logged = JSON.stringify([
        ...harness.logger.debug.mock.calls,
        ...harness.logger.warn.mock.calls
      ])
      expect(logged).toContain('catch-record.read')
      expect(logged).toContain('corr-9')
      expect(logged).not.toMatch(/user-a|Secret-Role|ReadOnlyUser/)
    })

    test('Should work without a logger', async () => {
      const authorizer = createCapabilityAuthorizer({
        userRoleCache: { getUserRoles: async () => rolesResult(['Owner']) },
        roleDefinitionsCache: {
          getRoleDefinitions: async () => definitionsResult()
        }
      })

      await expect(authorizer.authorize(user, READ)).resolves.toMatchObject({
        outcome: AuthorizationOutcome.ALLOWED
      })
    })
  })
})
