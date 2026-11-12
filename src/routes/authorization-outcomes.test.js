import Hapi from '@hapi/hapi'

import { AccessTokenFailure } from '#/authentication/entra/access-token-validator.js'
import { entraAuthenticationScheme } from '#/authentication/entra/entra-authentication-scheme.js'
import { ENTRA_AUTH_STRATEGY } from '#/authentication/entra/entra-auth-strategy.js'
import { Capability } from '#/authorization/capabilities.js'
import { createCapabilityAuthorizer } from '#/authorization/capability-authorizer.js'
import { protectedRoute } from '#/authorization/protected-route.js'
import { UserProfileOutcome } from '#/authorization/user-profile-client.js'
import { createSecurityTelemetry } from '#/authorization/security-telemetry.js'
import { failAction } from '#/common/helpers/fail-action.js'
import { capabilityEnforcement } from '#/plugins/capability-enforcement.js'
import { errorMapping } from '#/plugins/error-mapping.js'
import { requestTracing } from '#/plugins/request-tracing.js'
import Joi from 'joi'

const TRACE = 'trace-test-123'
const SECRET_PATTERN =
  /VRO5|Owner|catch-record|owner-1|definitionsVersion|OVER_STALE|NO_ASSIGNED|kid|issuer|audience|signature|EXPIRED|INVALID_|UNAVAILABLE_|stack|token/i

const DEFINITIONS = Object.freeze({
  definitionsVersion: '7',
  roles: Object.freeze([
    Object.freeze({
      roleId: 'Owner',
      capabilityIds: Object.freeze(['catch-record.read'])
    })
  ])
})
const defsOk = () => ({
  ok: true,
  snapshot: DEFINITIONS,
  freshness: 'fresh',
  cacheState: 'hit'
})
const rolesOk = (roleIds) => ({
  ok: true,
  value: { roleIds },
  cacheState: 'hit'
})
const dependency = (outcome, extra = {}) => ({
  ok: false,
  source: 'dependency',
  outcome,
  status: null,
  ...extra
})

async function createServer({
  validate,
  roles,
  definitions,
  capability = Capability.READ
}) {
  const server = Hapi.server({
    routes: { validate: { options: { abortEarly: false }, failAction } }
  })
  const logs = { debug: vi.fn(), info: vi.fn(), warn: vi.fn() }
  const metrics = {
    counter: vi.fn(async () => {}),
    millis: vi.fn(async () => {})
  }
  server.decorate(
    'server',
    'securityTelemetry',
    createSecurityTelemetry({ logger: logs, metrics })
  )
  await server.register([requestTracing, errorMapping])
  await server.register({
    plugin: {
      name: 'entra-authentication',
      register: (instance) => {
        instance.auth.scheme(ENTRA_AUTH_STRATEGY, entraAuthenticationScheme)
        instance.auth.strategy(ENTRA_AUTH_STRATEGY, ENTRA_AUTH_STRATEGY, {
          validator: { validate },
          userIdClaim: 'oid'
        })
      }
    }
  })
  await server.register({
    plugin: {
      name: 'user-role-cache',
      register: (instance) =>
        instance.decorate('server', 'userRoleCache', { getUserRoles: roles })
    }
  })
  await server.register({
    plugin: {
      name: 'role-definitions-cache',
      register: (instance) =>
        instance.decorate('server', 'roleDefinitionsCache', {
          getRoleDefinitions: definitions
        })
    }
  })
  await server.register({
    plugin: {
      name: 'capability-authorizer',
      register: (instance) =>
        instance.decorate(
          'server',
          'capabilityAuthorizer',
          createCapabilityAuthorizer({
            userRoleCache: instance.userRoleCache,
            roleDefinitionsCache: instance.roleDefinitionsCache
          })
        )
    }
  })
  await server.register(capabilityEnforcement)
  const handler = vi.fn(() => ({ ok: true }))
  server.route({
    method: 'POST',
    path: '/protected/{vesselId}',
    options: protectedRoute(
      { capability, vesselIdParam: 'vesselId' },
      { validate: { payload: Joi.object({ name: Joi.string().required() }) } }
    ),
    handler
  })

  return { server, handler, logs, metrics }
}

const validValidator = async () => ({
  ok: true,
  claims: Object.freeze({ oid: 'owner-1' })
})
const defaultRoles = async () => rolesOk(['VRO5--Owner'])
const send = (
  server,
  { authorization = 'Bearer any', payload = { name: 'x' } } = {}
) =>
  server.inject({
    method: 'POST',
    url: '/protected/VRO5',
    headers: { authorization, 'x-cdp-request-id': TRACE },
    payload
  })

describe('public authentication and authorization outcomes', () => {
  describe('401', () => {
    test.each(Object.values(AccessTokenFailure).map((reason) => [reason]))(
      'Should return one generic 401 with a Bearer challenge for the internal reason %s',
      async (reason) => {
        const { server, handler, logs } = await createServer({
          validate: async () => ({ ok: false, reason, source: 'credentials' }),
          roles: defaultRoles,
          definitions: async () => defsOk()
        })

        const response = await send(server)

        expect(response.statusCode).toBe(401)
        expect(response.headers['www-authenticate']).toBe('Bearer')
        expect(response.result).toEqual({
          statusCode: 401,
          code: 'AUTHENTICATION_REQUIRED',
          message: 'Authentication is required to access this resource.',
          correlationId: TRACE
        })
        expect(handler).not.toHaveBeenCalled()
        expect(logs.info).toHaveBeenCalledWith(
          expect.objectContaining({
            event: 'access-response',
            category: 'AUTHENTICATION_FAILURE',
            statusCode: 401,
            reason,
            correlationId: TRACE
          }),
          expect.any(String)
        )
      }
    )

    test('Should return the same 401 for a validly signed token whose identity claim is unusable', async () => {
      const { server } = await createServer({
        validate: async () => ({
          ok: true,
          claims: Object.freeze({ oid: 42 })
        }),
        roles: defaultRoles,
        definitions: async () => defsOk()
      })

      const response = await send(server)

      expect(response.statusCode).toBe(401)
      expect(response.headers['www-authenticate']).toBe('Bearer')
      expect(response.result.code).toBe('AUTHENTICATION_REQUIRED')
    })

    test('Should treat an unavailable signing-key source as a generic 401, never a 503, and never leak it', async () => {
      const { server } = await createServer({
        validate: async () => ({
          ok: false,
          reason: AccessTokenFailure.SIGNING_KEY_UNAVAILABLE,
          source: 'dependency'
        }),
        roles: defaultRoles,
        definitions: async () => defsOk()
      })

      const response = await send(server)

      expect(response.statusCode).toBe(401)
      expect(response.payload).not.toMatch(SECRET_PATTERN)
    })
  })

  describe('403', () => {
    test.each([
      [
        'an unknown user or a user with no roles',
        async () => rolesOk([]),
        async () => defsOk()
      ],
      [
        'no assigned role granting the capability',
        async () => rolesOk(['VRO5--Skipper', 'VRO5--Owner']),
        async () => defsOk(),
        Capability.UPDATE
      ],
      [
        'all assigned roles unknown',
        async () => rolesOk(['VRO5--Ghost']),
        async () => defsOk()
      ],
      [
        'an unknown required capability',
        async () => rolesOk(['VRO5--Owner']),
        async () => defsOk(),
        Capability.AMEND
      ],
      [
        'a role assigned for another vessel',
        async () => rolesOk(['PLDN--Owner']),
        async () => defsOk()
      ]
    ])(
      'Should return one indistinguishable safe 403 for %s',
      async (_name, roles, definitions, capability) => {
        const { server, handler } = await createServer({
          validate: validValidator,
          roles,
          definitions,
          capability
        })

        const response = await send(server)

        expect(response.statusCode).toBe(403)
        expect(response.headers['www-authenticate']).toBeUndefined()
        expect(response.result).toEqual({
          statusCode: 403,
          code: 'ACCESS_DENIED',
          message: 'You do not have permission to perform this operation.',
          correlationId: TRACE
        })
        expect(response.payload).not.toMatch(SECRET_PATTERN)
        expect(handler).not.toHaveBeenCalled()
      }
    )
  })

  describe('503', () => {
    test.each([
      [
        'user roles unavailable',
        async () => dependency(UserProfileOutcome.UNAVAILABLE),
        async () => defsOk()
      ],
      [
        'user-role refresh timed out after expiry',
        async () => dependency(UserProfileOutcome.TIMEOUT),
        async () => defsOk()
      ],
      [
        'an invalid user-role response',
        async () => ({
          ok: false,
          source: 'validation',
          reason: 'USER_ID_MISMATCH'
        }),
        async () => defsOk()
      ],
      [
        'no role-definition snapshot',
        defaultRoles,
        async () =>
          dependency(UserProfileOutcome.UNAVAILABLE, {
            snapshotState: 'absent'
          })
      ],
      [
        'role definitions over maximum stale',
        defaultRoles,
        async () =>
          dependency(UserProfileOutcome.UNAVAILABLE, {
            snapshotState: 'over-stale'
          })
      ],
      [
        'an invalid role-definition response',
        defaultRoles,
        async () => ({
          ok: false,
          source: 'validation',
          reason: 'EMPTY_ROLE_DEFINITIONS',
          snapshotState: 'absent'
        })
      ],
      [
        'an unexpected cache failure',
        defaultRoles,
        async () => ({
          ok: false,
          source: 'cache',
          reason: 'UNEXPECTED_CACHE_FAILURE'
        })
      ]
    ])(
      'Should return a safe temporary 503, not a 401 or 403, for %s',
      async (_name, roles, definitions) => {
        const { server, handler } = await createServer({
          validate: validValidator,
          roles,
          definitions
        })

        const response = await send(server)

        expect(response.statusCode).toBe(503)
        expect(response.headers['www-authenticate']).toBeUndefined()
        expect(response.headers['retry-after']).toBeUndefined()
        expect(response.result).toEqual({
          statusCode: 503,
          code: 'DEPENDENCY_UNAVAILABLE',
          message:
            'The service is temporarily unable to authorise this request.',
          correlationId: TRACE
        })
        expect(response.payload).not.toMatch(SECRET_PATTERN)
        expect(handler).not.toHaveBeenCalled()
      }
    )

    test('Should serve permitted stale definitions normally', async () => {
      const { server, handler } = await createServer({
        validate: validValidator,
        roles: defaultRoles,
        definitions: async () => ({
          ...defsOk(),
          freshness: 'stale',
          cacheState: 'stale-used'
        })
      })

      const response = await send(server)

      expect(response.statusCode).toBe(200)
      expect(handler).toHaveBeenCalledTimes(1)
    })
  })

  describe('preserved outcomes and headers', () => {
    test('Should keep the established 400 for invalid input after a granted capability', async () => {
      const { server } = await createServer({
        validate: validValidator,
        roles: defaultRoles,
        definitions: async () => defsOk()
      })

      const response = await send(server, { payload: {} })

      expect(response.statusCode).toBe(400)
      expect(response.result.code).toBe('INVALID_REQUEST')
      expect(response.headers['www-authenticate']).toBeUndefined()
    })

    test('Should not cache any authentication or authorization failure', async () => {
      const { server } = await createServer({
        validate: validValidator,
        roles: async () => rolesOk([]),
        definitions: async () => defsOk()
      })

      const response = await send(server)

      expect(response.headers['cache-control']).toBe('no-cache')
    })

    test('Should not accept a correlation value as identity or permission', async () => {
      const { server } = await createServer({
        validate: validValidator,
        roles: async () => rolesOk([]),
        definitions: async () => defsOk()
      })

      const response = await server.inject({
        method: 'POST',
        url: '/protected/VRO5',
        headers: {
          authorization: 'Bearer any',
          'x-cdp-request-id': 'owner-1--admin'
        },
        payload: { name: 'x' }
      })

      expect(response.statusCode).toBe(403)
    })

    test('Should not log identifiers, roles or tokens when emitting an access response', async () => {
      const { server, logs } = await createServer({
        validate: validValidator,
        roles: async () => rolesOk(['VRO5--Ghost']),
        definitions: async () => defsOk()
      })

      await send(server, { authorization: 'Bearer secret-token-value' })

      const logged = JSON.stringify([
        ...logs.debug.mock.calls,
        ...logs.info.mock.calls,
        ...logs.warn.mock.calls
      ])
      expect(logged).toContain('access-response')
      expect(logged).not.toMatch(/secret-token-value|owner-1|VRO5|Ghost/)
    })
  })
})
