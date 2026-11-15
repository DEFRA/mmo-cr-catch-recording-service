import { SignJWT } from 'jose'

import {
  createDeferred,
  createIntegratedServer,
  createTestSigningKey,
  createWorld,
  DEFINITIONS_MAXIMUM_STALE_SECONDS,
  DEFINITIONS_TTL_SECONDS,
  MINIMUM_REFRESH_SECONDS,
  TRACE_ID,
  USER_ROLE_TTL_SECONDS
} from './integrated-test-harness.js'
import {
  TEST_AUDIENCE,
  TEST_ISSUER
} from '#/authentication/entra/entra-test-fixtures.js'

const USER = '11111111-2222-4333-8444-555555555555'
const OTHER_USER = '99999999-8888-4777-8666-555555555555'
const VESSEL = 'VRO5'
const NOT_BLOCKED = [200, 201, 204, 400, 404, 409, 422]

// One request per approved capability; an allowed one reaches validation or the resource lookup
const OPERATIONS = Object.freeze({
  read: {
    capability: 'catch-record.read',
    request: { url: '/v1/catch-records/r-1' },
    reached: 404
  },
  create: {
    capability: 'catch-record.create',
    request: { method: 'POST', url: '/v1/catch-records', payload: {} },
    reached: 400
  },
  update: {
    capability: 'catch-record.update',
    request: {
      method: 'PATCH',
      url: '/v1/catch-records/r-1',
      headers: { 'if-match': '1' },
      payload: {}
    },
    reached: 400
  },
  submit: {
    capability: 'catch-record.submit',
    request: {
      method: 'POST',
      url: '/v1/catch-records/r-1/submission',
      headers: { 'if-match': '1' }
    },
    reached: 404
  },
  amend: {
    capability: 'catch-record.amend',
    request: {
      method: 'POST',
      url: '/v1/catch-records/r-1/edit-start',
      headers: { 'if-match': '1' }
    },
    reached: 404
  }
})

describe('integrated Entra authentication and capability authorization', () => {
  let signing
  let world
  let app

  beforeAll(async () => {
    signing = await createTestSigningKey('kid-integration-1')
  })

  beforeEach(async () => {
    world = createWorld({ signing })
    world.users[USER] = [`${VESSEL}--Owner`]
    app = await createIntegratedServer({ world, signing })
  })

  afterEach(async () => {
    await app.server.stop({ timeout: 0 })
  })

  const asUser = async (claims = {}) => app.token({ oid: USER, ...claims })
  const get = async (options) => app.call(await asUser(), options)

  describe('authentication', () => {
    test('Should authenticate a valid token, resolve roles through the User Profile Service and reach the resource layer', async () => {
      const response = await get()

      expect(NOT_BLOCKED).toContain(response.statusCode)
      expect(world.callsTo(`/users/${USER}/roles`)).toHaveLength(1)
      expect(world.countOf('/roles-definitions/')).toBe(1)
    })

    test.each([
      ['no credential', async () => null, {}],
      [
        'a non-bearer scheme',
        async () => null,
        { authorization: 'Basic dXNlcjpwYXNz' }
      ],
      [
        'an empty bearer credential',
        async () => null,
        { authorization: 'Bearer ' }
      ],
      ['a malformed JWT', async () => 'not-a-jwt', {}],
      ['a fixed legacy token', async () => 'read-token', {}]
    ])(
      'Should return 401 with a Bearer challenge and no downstream call for %s',
      async (_name, makeToken, headers) => {
        const response = await app.call(await makeToken(), { headers })

        expect(response.statusCode).toBe(401)
        expect(response.headers['www-authenticate']).toBe('Bearer')
        expect(world.countOf('/users/')).toBe(0)
        expect(app.persistence.reads).toEqual([])
      }
    )

    test('Should reject a token signed with another key, an unsigned token and a symmetric algorithm', async () => {
      const stranger = await createTestSigningKey('kid-integration-1')
      const unsigned = `${Buffer.from('{"alg":"none","kid":"kid-integration-1"}').toString('base64url')}.${Buffer.from('{}').toString('base64url')}.`
      const hs256 = await new SignJWT({
        oid: USER,
        iss: TEST_ISSUER,
        aud: TEST_AUDIENCE
      })
        .setProtectedHeader({ alg: 'HS256', kid: 'kid-integration-1' })
        .setExpirationTime('1h')
        .sign(new TextEncoder().encode('shared-secret-shared-secret-shared'))

      for (const bad of [
        await app.token({ oid: USER }, { signing: stranger }),
        unsigned,
        hs256
      ]) {
        expect((await app.call(bad)).statusCode).toBe(401)
      }
      expect(world.countOf('/users/')).toBe(0)
    })

    test.each([
      ['another issuer', { iss: 'https://login.other.invalid/t/v2.0' }],
      ['another audience', { aud: 'api://some-other-api' }],
      ['a missing identity claim', { oid: undefined }],
      ['a non-string identity claim', { oid: 42 }]
    ])('Should return 401 for %s', async (_name, claims) => {
      const response = await app.call(await app.token({ oid: USER, ...claims }))

      expect(response.statusCode).toBe(401)
      expect(world.countOf('/users/')).toBe(0)
    })

    test('Should enforce the token lifetime against the controlled clock', async () => {
      const early = await app.token({ oid: USER }, { notBefore: 120 })
      const shortLived = await app.token({ oid: USER }, { expiresIn: 600 })

      expect((await app.call(early)).statusCode).toBe(401)
      app.advanceSeconds(121)
      expect(NOT_BLOCKED).toContain((await app.call(early)).statusCode)

      expect(NOT_BLOCKED).toContain((await app.call(shortLived)).statusCode)
      app.advanceSeconds(600)
      expect((await app.call(shortLived)).statusCode).toBe(401)
    })

    test('Should take identity only from the validated token, never from headers, query or payload', async () => {
      world.users[OTHER_USER] = []

      const response = await app.call(await app.token({ oid: OTHER_USER }), {
        url: `/v1/catch-records?userId=${USER}`,
        headers: { 'x-user-id': USER, 'x-ms-client-principal-id': USER }
      })

      expect(response.statusCode).toBe(403)
      expect(world.callsTo(`/users/${USER}/`)).toHaveLength(0)
      expect(world.callsTo(`/users/${OTHER_USER}/roles`)).toHaveLength(1)
    })

    test('Should ignore roles, scopes and groups carried in the token', async () => {
      const response = await app.call(
        await app.token({
          oid: OTHER_USER,
          roles: ['Owner'],
          scp: 'catch-record.read',
          groups: ['admins']
        })
      )

      expect(response.statusCode).toBe(403)
    })
  })

  describe('signing keys and rollover', () => {
    test('Should serve known keys from the snapshot without further JWKS requests', async () => {
      await get()
      await get()
      await get()

      expect(world.countOf('openid-configuration')).toBe(1)
      expect(world.countOf('/keys')).toBe(1)
    })

    test('Should refresh once for an unknown kid and succeed when the refreshed set contains it', async () => {
      const next = await createTestSigningKey('kid-integration-2')
      await get()
      world.keys = [signing.publicJwk, next.publicJwk]
      app.advanceSeconds(MINIMUM_REFRESH_SECONDS)

      const response = await app.call(
        await app.token({ oid: USER }, { signing: next })
      )

      expect(NOT_BLOCKED).toContain(response.statusCode)
      expect(world.countOf('/keys')).toBe(2)
      expect(JSON.stringify(app.logs.warn.mock.calls)).not.toMatch(
        /kid-integration/
      )
    })

    test('Should refresh once for an unresolved kid, return 401, and not storm on repeated hostile kids', async () => {
      const stranger = await createTestSigningKey('kid-never-published')
      await get()
      app.advanceSeconds(MINIMUM_REFRESH_SECONDS)

      for (let i = 0; i < 5; i++) {
        const response = await app.call(
          await app.token({ oid: USER }, { signing: stranger })
        )
        expect(response.statusCode).toBe(401)
      }

      expect(world.countOf('/keys')).toBe(2)
    })

    test('Should roll over to a new key without ever replacing the snapshot with invalid data', async () => {
      const next = await createTestSigningKey('kid-integration-2')
      const tokenA = await asUser()
      expect(NOT_BLOCKED).toContain((await app.call(tokenA)).statusCode)

      world.jwksMode = 'invalid'
      app.advanceSeconds(MINIMUM_REFRESH_SECONDS)
      const tokenB = await app.token({ oid: USER }, { signing: next })
      expect((await app.call(tokenB)).statusCode).toBe(401)
      expect(NOT_BLOCKED).toContain((await app.call(tokenA)).statusCode)

      world.jwksMode = 'ok'
      world.keys = [next.publicJwk]
      app.advanceSeconds(MINIMUM_REFRESH_SECONDS)
      expect(NOT_BLOCKED).toContain((await app.call(tokenB)).statusCode)
    })
  })

  describe('User Profile Service integration', () => {
    test('Should request roles for the trusted user only, encode the path and propagate the correlation id', async () => {
      await get()

      const [rolesCall] = world.callsTo('/users/')
      expect(rolesCall.url).toBe(
        `https://user-profile.test.invalid/users/${USER}/roles`
      )
      for (const call of [rolesCall, ...world.callsTo('/roles-definitions/')]) {
        expect(call.headers['x-cdp-request-id']).toBe(TRACE_ID)
        expect(
          Object.keys(call.headers).map((name) => name.toLowerCase())
        ).not.toContain('authorization')
      }
    })

    test.each([
      ['an unknown user', undefined, 403],
      ['a user with no roles', [], 403]
    ])(
      'Should deny %s with 403 and never assign a default role',
      async (_name, roles, status) => {
        world.users[OTHER_USER] = roles

        const response = await app.call(await app.token({ oid: OTHER_USER }))

        expect(response.statusCode).toBe(status)
        expect(app.persistence.reads).toEqual([])
      }
    )

    test.each([
      [
        'a response for another user',
        () => {
          world.userRolesMode = 'wrong-user'
        }
      ],
      [
        'a failing roles endpoint',
        () => {
          world.userRolesMode = 'fail'
        }
      ],
      [
        'empty role definitions',
        () => {
          world.definitionsMode = 'empty'
        }
      ],
      [
        'definitions for another service',
        () => {
          world.definitionsMode = 'wrong-service'
        }
      ],
      [
        'a failing definitions endpoint',
        () => {
          world.definitionsMode = 'fail'
        }
      ]
    ])(
      'Should return 503 for %s, deny the operation and not cache the failure',
      async (_name, arrange) => {
        arrange()

        const first = await get()
        world.userRolesMode = 'ok'
        world.definitionsMode = 'ok'
        const recovered = await get()

        expect(first.statusCode).toBe(503)
        expect(app.persistence.writes).toEqual([])
        expect(NOT_BLOCKED).toContain(recovered.statusCode)
      }
    )
  })

  describe('user-role cache', () => {
    test('Should serve roles from the cache before the TTL and refresh exactly at it', async () => {
      await get()
      app.advanceSeconds(USER_ROLE_TTL_SECONDS - 1)
      await get()
      expect(world.countOf('/users/')).toBe(1)

      app.advanceSeconds(1)
      await get()
      expect(world.countOf('/users/')).toBe(2)
    })

    test('Should apply a role removal no later than the TTL, with 403 and no side effect', async () => {
      expect(NOT_BLOCKED).toContain((await get()).statusCode)
      world.users[USER] = []

      app.advanceSeconds(USER_ROLE_TTL_SECONDS - 1)
      expect(NOT_BLOCKED).toContain((await get()).statusCode)

      app.advanceSeconds(1)
      const response = await get({
        method: 'POST',
        url: '/v1/catch-records',
        payload: { vesselId: VESSEL }
      })
      expect(response.statusCode).toBe(403)
      expect(app.persistence.writes).toEqual([])
    })

    test('Should not use expired roles when the refresh fails, not extend the expiry, and recover later', async () => {
      await get()
      app.advanceSeconds(USER_ROLE_TTL_SECONDS)
      world.userRolesMode = 'fail'

      expect((await get()).statusCode).toBe(503)
      app.advanceSeconds(1)
      expect((await get()).statusCode).toBe(503)

      world.userRolesMode = 'ok'
      expect(NOT_BLOCKED).toContain((await get()).statusCode)
    })

    test('Should coalesce concurrent requests for one uncached user into one roles request and isolate other users', async () => {
      world.users[OTHER_USER] = [`${VESSEL}--ReadOnlyUser`]
      world.userRolesGate = createDeferred()
      const mine = await asUser()
      const theirs = await app.token({ oid: OTHER_USER })

      const pending = Promise.all([
        app.call(mine),
        app.call(mine),
        app.call(mine),
        app.call(theirs)
      ])
      await vi.waitFor(() => expect(world.countOf('/users/')).toBe(2))
      await new Promise((resolve) => setTimeout(resolve, 50))
      world.userRolesGate.release()
      const responses = await pending

      expect(world.callsTo(`/users/${USER}/roles`)).toHaveLength(1)
      expect(
        responses.map((response) => NOT_BLOCKED.includes(response.statusCode))
      ).toEqual([true, true, true, true])
    })
  })

  describe('role-definition cache', () => {
    test('Should load lazily once, then serve fresh snapshots without another request', async () => {
      await get()
      app.advanceSeconds(DEFINITIONS_TTL_SECONDS - 1)
      await get()

      expect(world.countOf('/roles-definitions/')).toBe(1)
    })

    test('Should refresh after the TTL and use the new definitions', async () => {
      expect(NOT_BLOCKED).toContain((await get()).statusCode)
      world.definitionsVersion = '2'
      world.definitions = [
        { roleId: 'Owner', capabilityIds: ['catch-record.create'] }
      ]
      app.advanceSeconds(DEFINITIONS_TTL_SECONDS)

      const read = await get()

      expect(world.countOf('/roles-definitions/')).toBe(2)
      expect(read.statusCode).toBe(403)
    })

    test('Should keep authorizing from a stale snapshot within the maximum stale window, without extending it', async () => {
      await get()
      world.definitionsMode = 'fail'
      app.advanceSeconds(DEFINITIONS_TTL_SECONDS)

      expect(NOT_BLOCKED).toContain((await get()).statusCode)
      app.advanceSeconds(DEFINITIONS_MAXIMUM_STALE_SECONDS - 1)
      expect(NOT_BLOCKED).toContain((await get()).statusCode)
      expect(app.logs.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'role-definitions-cache.refresh-failed'
        }),
        expect.any(String)
      )
    })

    test('Should fail closed with 503 once the maximum stale window is exhausted and never extend it', async () => {
      await get()
      world.definitionsMode = 'fail'
      app.advanceSeconds(
        DEFINITIONS_TTL_SECONDS + DEFINITIONS_MAXIMUM_STALE_SECONDS
      )

      const response = await get({
        method: 'POST',
        url: '/v1/catch-records',
        payload: { vesselId: VESSEL }
      })
      app.advanceSeconds(1)
      const again = await get()

      expect(response.statusCode).toBe(503)
      expect(again.statusCode).toBe(503)
      expect(app.persistence.writes).toEqual([])
    })

    test('Should never replace a valid snapshot with an invalid refresh', async () => {
      await get()
      world.definitionsMode = 'empty'
      app.advanceSeconds(DEFINITIONS_TTL_SECONDS)

      expect(NOT_BLOCKED).toContain((await get()).statusCode)

      app.advanceSeconds(DEFINITIONS_MAXIMUM_STALE_SECONDS)
      expect((await get()).statusCode).toBe(503)
    })

    test('Should coalesce concurrent first loads into one definitions request', async () => {
      world.definitionsGate = createDeferred()
      const mine = await asUser()

      const pending = Promise.all([
        app.call(mine),
        app.call(mine),
        app.call(mine)
      ])
      await vi.waitFor(() =>
        expect(world.countOf('/roles-definitions/')).toBe(1)
      )
      await new Promise((resolve) => setTimeout(resolve, 50))
      world.definitionsGate.release()
      const responses = await pending

      expect(world.countOf('/roles-definitions/')).toBe(1)
      expect(
        responses.every((response) => NOT_BLOCKED.includes(response.statusCode))
      ).toBe(true)
    })
  })

  describe('capability authorization and endpoint mapping', () => {
    test.each(Object.entries(OPERATIONS))(
      'Should authorize %s by exactly its own capability',
      async (name, operation) => {
        world.users[USER] = [
          `${VESSEL}--${name === 'read' ? 'ReadOnlyUser' : { create: 'Owner', update: 'Owner', submit: 'Submitter', amend: 'Skipper' }[name]}`
        ]

        const response = await get(operation.request)

        expect(response.statusCode).toBe(operation.reached)
      }
    )

    test.each(Object.entries(OPERATIONS))(
      'Should deny %s to a user whose roles lack %s',
      async (name, operation) => {
        world.definitions = [
          { roleId: 'Narrow', capabilityIds: ['catch-record.read'] },
          {
            roleId: 'Other',
            capabilityIds: Object.values(OPERATIONS).map((op) => op.capability)
          }
        ]
        world.users[USER] = [`${VESSEL}--Narrow`]

        const response = await get(operation.request)

        expect(response.statusCode).toBe(
          name === 'read' ? operation.reached : 403
        )
        expect(app.persistence.writes).toEqual([])
      }
    )

    test('Should not let update authorise submission or amendment, nor submission authorise update', async () => {
      world.users[USER] = [`${VESSEL}--Owner`]

      expect((await get(OPERATIONS.submit.request)).statusCode).toBe(403)
      expect((await get(OPERATIONS.amend.request)).statusCode).toBe(403)
      world.users[USER] = [`${VESSEL}--Submitter`]
      app.advanceSeconds(USER_ROLE_TTL_SECONDS)
      expect((await get(OPERATIONS.update.request)).statusCode).toBe(403)
      expect((await get(OPERATIONS.submit.request)).statusCode).toBe(404)
    })

    test('Should allow when any one of several roles grants the capability and ignore unknown roles', async () => {
      world.users[USER] = [
        `${VESSEL}--Ghost`,
        'Owner',
        `${VESSEL}--ReadOnlyUser`,
        `${VESSEL}--Submitter`
      ]

      expect((await get(OPERATIONS.submit.request)).statusCode).toBe(404)
      expect((await get(OPERATIONS.create.request)).statusCode).toBe(403)
    })

    test('Should apply vessel-scoped roles to the vessel in the path only', async () => {
      world.users[USER] = ['VRO5--Owner', 'PLDN--ReadOnlyUser']

      const own = await get({ url: '/v1/vessels/VRO5/skippers' })
      const readOnlyWrite = await get({
        method: 'POST',
        url: '/v1/vessels/PLDN/skippers',
        payload: { name: 'Jane Doe' }
      })
      const stranger = await get({ url: '/v1/vessels/XYZ1/skippers' })

      // The recording db stub is not a full skipper store, so only authorization is asserted
      expect([401, 403, 503]).not.toContain(own.statusCode)
      expect(readOnlyWrite.statusCode).toBe(403)
      expect(stranger.statusCode).toBe(403)
    })

    test('Should deny a capability that is unknown to the current definitions', async () => {
      world.definitions = [
        { roleId: 'Owner', capabilityIds: ['catch-record.read'] }
      ]

      expect((await get(OPERATIONS.amend.request)).statusCode).toBe(403)
    })
  })

  describe('resource and domain composition', () => {
    test('Should keep an allowed capability from bypassing resource access: a missing record stays a masked 404 with no write', async () => {
      world.users[USER] = [
        `${VESSEL}--Owner`,
        `${VESSEL}--Submitter`,
        `${VESSEL}--Skipper`
      ]

      const statuses = []
      for (const name of ['read', 'submit', 'amend']) {
        statuses.push((await get(OPERATIONS[name].request)).statusCode)
      }

      expect(statuses).toEqual([404, 404, 404])
      expect(app.persistence.writes).toEqual([])
    })

    test('Should reject invalid input with 400 only after the capability was granted', async () => {
      expect((await get(OPERATIONS.update.request)).statusCode).toBe(400)

      world.users[OTHER_USER] = []
      const denied = await app.call(
        await app.token({ oid: OTHER_USER }),
        OPERATIONS.update.request
      )
      expect(denied.statusCode).toBe(403)
    })

    test('Should perform no persistence read or write after a denial or an unavailable decision', async () => {
      world.users[OTHER_USER] = []
      const denied = await app.call(
        await app.token({ oid: OTHER_USER }),
        OPERATIONS.update.request
      )
      world.userRolesMode = 'fail'
      const unavailable = await get(OPERATIONS.submit.request)

      expect([denied.statusCode, unavailable.statusCode]).toEqual([403, 503])
      expect(app.persistence.reads).toEqual([])
      expect(app.persistence.writes).toEqual([])
    })
  })

  describe('public outcomes and observability', () => {
    test('Should return one safe body per outcome with the correlation id and no authorization internals', async () => {
      world.users[OTHER_USER] = []
      const unauthenticated = await app.call('read-token')
      const forbidden = await app.call(await app.token({ oid: OTHER_USER }))
      world.userRolesMode = 'fail'
      const unavailable = await get()

      expect(
        [unauthenticated, forbidden, unavailable].map(
          (response) => response.result
        )
      ).toEqual([
        {
          statusCode: 401,
          code: 'AUTHENTICATION_REQUIRED',
          message: 'Authentication is required to access this resource.',
          correlationId: TRACE_ID
        },
        {
          statusCode: 403,
          code: 'ACCESS_DENIED',
          message: 'You do not have permission to perform this operation.',
          correlationId: TRACE_ID
        },
        {
          statusCode: 503,
          code: 'DEPENDENCY_UNAVAILABLE',
          message:
            'The service is temporarily unable to authorise this request.',
          correlationId: TRACE_ID
        }
      ])
      expect(
        [unauthenticated, forbidden, unavailable].map(
          (r) => r.headers['www-authenticate']
        )
      ).toEqual(['Bearer', undefined, undefined])
    })

    test('Should emit bounded, privacy-safe telemetry for a full flow and leak no identity, role, token or key detail', async () => {
      const bearer = await asUser()
      world.users[OTHER_USER] = []
      await app.call(bearer)
      await app.call(await app.token({ oid: OTHER_USER }))
      await app.call('read-token')

      const everything = JSON.stringify([
        ...Object.values(app.logs).flatMap((fn) => fn.mock.calls),
        ...app.metrics.counter.mock.calls,
        ...app.metrics.millis.mock.calls
      ])
      expect(everything).toContain(TRACE_ID)
      expect(everything).not.toContain(bearer)
      expect(everything).not.toMatch(
        new RegExp(
          `${USER}|${OTHER_USER}|Owner|kid-integration|read-token|user-profile\\.test`
        )
      )
      const names = new Set(
        app.metrics.counter.mock.calls.map(([name]) => name)
      )
      expect([...names]).toEqual(
        expect.arrayContaining([
          'authTokenValidations',
          'authDecisions',
          'authHttpOutcomes',
          'authUserProfileRequests'
        ])
      )
      for (const [, , dimensions] of app.metrics.counter.mock.calls) {
        expect(JSON.stringify(dimensions)).not.toContain(TRACE_ID)
      }
    })
  })
})
