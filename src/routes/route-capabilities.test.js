import Hapi from '@hapi/hapi'

import {
  allowedDecision,
  registerStubAuthorization
} from '#/authorization/authorization-test-fixtures.js'
import { Capability } from '#/authorization/capabilities.js'
import {
  AuthorizationOutcome,
  createCapabilityAuthorizer,
  DenialReason,
  UnavailableReason
} from '#/authorization/capability-authorizer.js'
import { protectedRoute } from '#/authorization/protected-route.js'
import { createAuthenticatedUserContext } from '#/authentication/entra/authenticated-user-context.js'
import { errorMapping } from '#/plugins/error-mapping.js'
import { getCapabilityDecision } from '#/plugins/capability-enforcement.js'
import { requestTracing } from '#/plugins/request-tracing.js'
import { catchRecords } from './catch-records.js'
import { vesselProfiles } from './vessel-profiles.js'

const BEARER = { authorization: 'Bearer token-1' }

async function createServer({ routes, authorize, authorizerAvailable } = {}) {
  const server = Hapi.server()
  await server.register([requestTracing, errorMapping])
  const stub = await registerStubAuthorization(server, {
    authorize,
    authorizerAvailable
  })
  server.route(routes)
  return { server, ...stub }
}

describe('endpoint-to-capability mapping', () => {
  test('Should map every protected operation to exactly one approved capability', async () => {
    const { server } = await createServer({
      routes: [...catchRecords, ...vesselProfiles]
    })

    const mapping = server
      .table()
      .map((route) => {
        const { requiredCapabilityId, vesselIdParam } = route.settings.app
        return [
          `${route.method.toUpperCase()} ${route.path}`,
          requiredCapabilityId,
          vesselIdParam ?? null
        ]
      })
      .sort((a, b) => a[0].localeCompare(b[0]))

    expect(mapping).toEqual(
      [
        ['GET /v1/catch-records', 'catch-record.read', null],
        ['POST /v1/catch-records', 'catch-record.create', null],
        ['GET /v1/catch-records/{catchRecordId}', 'catch-record.read', null],
        ['PUT /v1/catch-records/{catchRecordId}', 'catch-record.update', null],
        [
          'PATCH /v1/catch-records/{catchRecordId}',
          'catch-record.update',
          null
        ],
        [
          'DELETE /v1/catch-records/{catchRecordId}',
          'catch-record.update',
          null
        ],
        [
          'GET /v1/catch-records/{catchRecordId}/history',
          'catch-record.read',
          null
        ],
        [
          'POST /v1/catch-records/{catchRecordId}/submission',
          'catch-record.submit',
          null
        ],
        [
          'GET /v1/catch-records/{catchRecordId}/submissions',
          'catch-record.read',
          null
        ],
        [
          'GET /v1/catch-records/{catchRecordId}/submissions/{submissionNumber}/{artifactType}',
          'catch-record.read',
          null
        ],
        [
          'POST /v1/catch-records/{catchRecordId}/edit-start',
          'catch-record.amend',
          null
        ],
        ...['gears', 'species', 'ports'].flatMap((kind) => [
          [
            `GET /v1/vessels/{vesselId}/favourite-${kind}`,
            'catch-record.read',
            'vesselId'
          ],
          [
            `POST /v1/vessels/{vesselId}/favourite-${kind}`,
            'catch-record.update',
            'vesselId'
          ],
          [
            `DELETE /v1/vessels/{vesselId}/favourite-${kind}/{${{ gears: 'gearId', species: 'speciesId', ports: 'portId' }[kind]}}`,
            'catch-record.update',
            'vesselId'
          ]
        ]),
        [
          'GET /v1/vessels/{vesselId}/skippers',
          'catch-record.read',
          'vesselId'
        ],
        [
          'POST /v1/vessels/{vesselId}/skippers',
          'catch-record.update',
          'vesselId'
        ],
        [
          'DELETE /v1/vessels/{vesselId}/skippers/{skipperId}',
          'catch-record.update',
          'vesselId'
        ]
      ].sort((a, b) => a[0].localeCompare(b[0]))
    )
  })

  test('Should no longer expose the deprecated completion route', async () => {
    const { server } = await createServer({ routes: catchRecords })

    expect(server.table().map((route) => route.path)).not.toContainEqual(
      expect.stringContaining('/completion')
    )
  })

  test.each([
    ['GET', '/v1/catch-records', 'catch-record.read'],
    ['POST', '/v1/catch-records', 'catch-record.create'],
    ['PATCH', '/v1/catch-records/r-1', 'catch-record.update'],
    ['POST', '/v1/catch-records/r-1/submission', 'catch-record.submit'],
    ['POST', '/v1/catch-records/r-1/edit-start', 'catch-record.amend']
  ])(
    'Should evaluate %s %s for the trusted user and the %s capability before any validation',
    async (method, url, capabilityId) => {
      const { server, authorize } = await createServer({ routes: catchRecords })
      await server.initialize()

      // An invalid payload is not even looked at when the capability is denied
      authorize.mockResolvedValue({
        outcome: AuthorizationOutcome.DENIED,
        reason: DenialReason.CAPABILITY_NOT_GRANTED
      })
      const response = await server.inject({
        method,
        url,
        headers: BEARER,
        payload: method === 'GET' ? undefined : { garbage: true }
      })

      expect(response.statusCode).toBe(403)
      expect(authorize).toHaveBeenCalledTimes(1)
      const [user, capability, options] = authorize.mock.calls[0]
      expect(user).toEqual({ userId: 'owner-1' })
      expect(capability.capabilityId).toBe(capabilityId)
      expect(options.vesselId).toBeUndefined()
    }
  )

  test('Should evaluate vessel routes for the exact vessel in the path', async () => {
    const { server, authorize } = await createServer({ routes: vesselProfiles })
    await server.initialize()
    authorize.mockResolvedValue({
      outcome: AuthorizationOutcome.DENIED,
      reason: DenialReason.CAPABILITY_NOT_GRANTED
    })

    await server.inject({
      method: 'GET',
      url: '/v1/vessels/VRO5/skippers',
      headers: BEARER
    })
    await server.inject({
      method: 'POST',
      url: '/v1/vessels/PLDN/skippers',
      headers: BEARER,
      payload: {}
    })

    expect(
      authorize.mock.calls.map(([, c, o]) => [c.capabilityId, o.vesselId])
    ).toEqual([
      ['catch-record.read', 'VRO5'],
      ['catch-record.update', 'PLDN']
    ])
  })
})

describe('capability enforcement boundary', () => {
  const probe = (handler) => ({
    method: 'GET',
    path: '/probe/{vesselId}',
    options: protectedRoute(
      { capability: Capability.READ, vesselIdParam: 'vesselId' },
      {}
    ),
    handler
  })

  test('Should run the handler only after an allowed decision and expose that decision', async () => {
    const handler = vi.fn((request) => ({
      granted: getCapabilityDecision(request).grantedVesselIds
    }))
    const { server } = await createServer({
      routes: [probe(handler)],
      authorize: async () => ({
        ...allowedDecision,
        grantedVesselIds: ['VRO5']
      })
    })

    const response = await server.inject({
      method: 'GET',
      url: '/probe/VRO5',
      headers: BEARER
    })

    expect(response.statusCode).toBe(200)
    expect(response.result).toEqual({ granted: ['VRO5'] })
  })

  test.each([
    [
      'a denial',
      {
        outcome: AuthorizationOutcome.DENIED,
        reason: DenialReason.NO_ASSIGNED_ROLES
      },
      403,
      'ACCESS_DENIED'
    ],
    [
      'an unavailable user-role source',
      {
        outcome: AuthorizationOutcome.UNAVAILABLE,
        reason: UnavailableReason.USER_ROLES_UNAVAILABLE
      },
      503,
      'DEPENDENCY_UNAVAILABLE'
    ],
    [
      'over-stale role definitions',
      {
        outcome: AuthorizationOutcome.UNAVAILABLE,
        reason: UnavailableReason.ROLE_DEFINITIONS_OVER_STALE
      },
      503,
      'DEPENDENCY_UNAVAILABLE'
    ],
    [
      'a cancellation',
      {
        outcome: AuthorizationOutcome.UNAVAILABLE,
        reason: UnavailableReason.CANCELLED
      },
      503,
      'DEPENDENCY_UNAVAILABLE'
    ],
    [
      'an internal wiring failure',
      {
        outcome: AuthorizationOutcome.UNAVAILABLE,
        reason: UnavailableReason.INTERNAL_FAILURE
      },
      500,
      'INTERNAL_SERVER_ERROR'
    ]
  ])(
    'Should stop before the handler for %s with a safe %i',
    async (_name, decision, status, code) => {
      const handler = vi.fn(() => 'executed')
      const { server } = await createServer({
        routes: [probe(handler)],
        authorize: async () => decision
      })

      const response = await server.inject({
        method: 'GET',
        url: '/probe/VRO5',
        headers: BEARER
      })

      expect(handler).not.toHaveBeenCalled()
      expect(response.statusCode).toBe(status)
      expect(response.result.code).toBe(code)
      expect(response.payload).not.toMatch(
        /NO_ASSIGNED|OVER_STALE|catch-record|VRO5|owner-1/
      )
    }
  )

  test('Should not evaluate capabilities for an unauthenticated or fixed-token request', async () => {
    const handler = vi.fn(() => 'executed')
    const { server, authorize } = await createServer({
      routes: [probe(handler)]
    })

    const none = await server.inject({ method: 'GET', url: '/probe/VRO5' })
    const fixed = await server.inject({
      method: 'GET',
      url: '/probe/VRO5',
      headers: { authorization: 'Bearer read-token' }
    })

    expect([none.statusCode, fixed.statusCode]).toEqual([401, 401])
    expect(authorize).not.toHaveBeenCalled()
    expect(handler).not.toHaveBeenCalled()
  })

  test('Should take the capability only from the route, never from request data', async () => {
    const { server, authorize } = await createServer({
      routes: [probe(() => 'ok')]
    })

    await server.inject({
      method: 'GET',
      url: '/probe/VRO5?capability=catch-record.submit&userId=attacker',
      headers: {
        ...BEARER,
        'x-capability': 'catch-record.amend',
        'x-user-id': 'attacker'
      }
    })

    const [user, capability] = authorize.mock.calls[0]
    expect(capability).toBe(Capability.READ)
    expect(user.userId).toBe('owner-1')
  })

  test('Should leave public routes untouched', async () => {
    const { server, authorize } = await createServer({
      routes: [
        {
          method: 'GET',
          path: '/public',
          options: { auth: false },
          handler: () => 'ok'
        },
        { method: 'GET', path: '/default', handler: () => 'ok' }
      ]
    })

    const responses = await Promise.all([
      server.inject({ url: '/public' }),
      server.inject({ url: '/default' })
    ])

    expect(responses.map((r) => r.statusCode)).toEqual([200, 200])
    expect(authorize).not.toHaveBeenCalled()
  })

  test('Should fail closed per request and at startup for a protected route with no capability', async () => {
    const handler = vi.fn(() => 'executed')
    const { server, authorize } = await createServer({
      routes: [
        {
          method: 'GET',
          path: '/unmapped',
          options: { auth: 'entra-bearer' },
          handler
        }
      ]
    })

    const response = await server.inject({
      method: 'GET',
      url: '/unmapped',
      headers: BEARER
    })

    expect(response.statusCode).toBe(500)
    expect(handler).not.toHaveBeenCalled()
    expect(authorize).not.toHaveBeenCalled()
    await expect(server.initialize()).rejects.toThrow('GET /unmapped')
  })

  test.each([
    ['an unknown capability', { requiredCapabilityId: 'catch-record.*' }],
    ['a role name', { requiredCapabilityId: 'Owner' }],
    [
      'a vessel parameter absent from the path',
      { requiredCapabilityId: 'catch-record.read', vesselIdParam: 'missing' }
    ]
  ])('Should refuse to start and fail closed for %s', async (_name, app) => {
    const { server, authorize } = await createServer({
      routes: [
        {
          method: 'GET',
          path: '/bad/{id}',
          options: { auth: 'entra-bearer', app },
          handler: () => 'ok'
        }
      ]
    })

    const response = await server.inject({
      method: 'GET',
      url: '/bad/1',
      headers: BEARER
    })

    expect(response.statusCode).toBe(500)
    expect(authorize).not.toHaveBeenCalled()
    await expect(server.initialize()).rejects.toThrow('GET /bad/{id}')
  })

  test('Should refuse to start for a route that bypasses the Entra strategy', async () => {
    const server = Hapi.server()
    await registerStubAuthorization(server)
    server.auth.scheme('other', () => ({
      authenticate: (_request, h) => h.authenticated({ credentials: {} })
    }))
    server.auth.strategy('other', 'other')
    server.route({
      method: 'GET',
      path: '/legacy',
      options: {
        auth: 'other',
        app: { requiredCapabilityId: 'catch-record.read' }
      },
      handler: () => 'ok'
    })

    await expect(server.initialize()).rejects.toThrow('GET /legacy')
  })

  test('Should fail closed when the authorizer is not configured', async () => {
    const handler = vi.fn(() => 'executed')
    const { server } = await createServer({
      routes: [probe(handler)],
      authorizerAvailable: false
    })

    const response = await server.inject({
      method: 'GET',
      url: '/probe/VRO5',
      headers: BEARER
    })

    expect(response.statusCode).toBe(503)
    expect(handler).not.toHaveBeenCalled()
  })

  test('Should fail closed when a declared vessel parameter is absent from the request', async () => {
    const { server, authorize } = await createServer({
      routes: [
        {
          method: 'GET',
          path: '/probe/{vesselId*}',
          options: protectedRoute({
            capability: Capability.READ,
            vesselIdParam: 'vesselId'
          }),
          handler: () => 'ok'
        }
      ]
    })

    const response = await server.inject({
      method: 'GET',
      url: '/probe',
      headers: BEARER
    })

    expect(response.statusCode).toBe(500)
    expect(authorize).not.toHaveBeenCalled()
  })
})

describe('capability enforcement with the real engine', () => {
  const definitions = {
    ok: true,
    snapshot: Object.freeze({
      definitionsVersion: '1',
      roles: Object.freeze([
        Object.freeze({
          roleId: 'Owner',
          capabilityIds: Object.freeze([
            'catch-record.read',
            'catch-record.create'
          ])
        }),
        Object.freeze({
          roleId: 'Skipper',
          capabilityIds: Object.freeze(['catch-record.read'])
        })
      ])
    }),
    freshness: 'fresh',
    cacheState: 'hit'
  }
  const createRealServer = async (assignedRoles) => {
    const authorizer = createCapabilityAuthorizer({
      userRoleCache: {
        getUserRoles: async () => ({
          ok: true,
          value: { roleIds: assignedRoles },
          cacheState: 'hit'
        })
      },
      roleDefinitionsCache: { getRoleDefinitions: async () => definitions }
    })
    return createServer({
      routes: [
        {
          method: 'GET',
          path: '/vessels/{vesselId}',
          options: protectedRoute({
            capability: Capability.READ,
            vesselIdParam: 'vesselId'
          }),
          handler: () => 'ok'
        },
        {
          method: 'POST',
          path: '/vessels/{vesselId}',
          options: protectedRoute({
            capability: Capability.CREATE,
            vesselIdParam: 'vesselId'
          }),
          handler: () => 'ok'
        }
      ],
      authorize: (user, capability, options) =>
        authorizer.authorize(
          createAuthenticatedUserContext({ oid: user.userId }, 'oid').user,
          capability,
          options
        )
    })
  }

  test('Should authorise by the capability of the role assigned for that vessel', async () => {
    const { server } = await createRealServer(['VRO5--Owner', 'PLDN--Skipper'])
    const call = (method, vesselId) =>
      server.inject({ method, url: `/vessels/${vesselId}`, headers: BEARER })

    expect((await call('GET', 'VRO5')).statusCode).toBe(200)
    expect((await call('POST', 'VRO5')).statusCode).toBe(200)
    expect((await call('GET', 'PLDN')).statusCode).toBe(200)
    expect((await call('POST', 'PLDN')).statusCode).toBe(403)
    expect((await call('GET', 'OTHER')).statusCode).toBe(403)
  })

  test('Should deny a user with no roles and an unscoped role', async () => {
    for (const roles of [[], ['Owner']]) {
      const { server } = await createRealServer(roles)

      const response = await server.inject({
        method: 'GET',
        url: '/vessels/VRO5',
        headers: BEARER
      })

      expect(response.statusCode).toBe(403)
    }
  })
})
