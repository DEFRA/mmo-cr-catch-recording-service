/* global fetchMock */
import { SignJWT } from 'jose'

import {
  createTestSigningKey,
  signTestToken,
  TEST_JWKS_URI
} from '#/authentication/entra/entra-test-fixtures.js'

const FIXED_TOKENS = ['read-token', 'write-token', 'admin-token', 'mock-token']
const USER_ID = 'user-abc'

describe('server authentication wiring (no legacy authentication path)', () => {
  let config
  let server
  let signing
  let userProfileCalls

  beforeAll(async () => {
    signing = await createTestSigningKey('kid-server-test')
    // Dynamic import needed due to config being updated by vitest-mongodb (mirrors
    // `src/plugins/mongodb.test.js`): a static import would read MONGO_URI before it is set.
    ;({ config } = await import('#/config.js'))
    const { createServer } = await import('#/server.js')
    server = await createServer()
    await server.initialize()
  })

  afterAll(async () => {
    await server?.stop({ timeout: 0 })
  })

  beforeEach(() => {
    userProfileCalls = []
    fetchMock.resetMocks()
    fetchMock.mockResponse(async (request) => {
      const { url } = request
      const json = (body) => ({
        body: JSON.stringify(body),
        status: 200,
        headers: { 'content-type': 'application/json' }
      })

      if (url === config.get('entra.oidcMetadataUrl')) {
        return json({
          issuer: config.get('entra.issuer'),
          jwks_uri: TEST_JWKS_URI
        })
      }
      if (url === TEST_JWKS_URI) {
        return json({ keys: [signing.publicJwk] })
      }
      userProfileCalls.push(url)
      if (url.includes('/roles-definitions/')) {
        return json({
          schemaVersion: '1.0',
          definitionsVersion: '1',
          serviceId: 'catch-recording',
          roles: [{ roleId: 'Owner', capabilityIds: ['catch-record.read'] }]
        })
      }
      return json({
        schemaVersion: '1.0',
        definitionsVersion: '1',
        userId: USER_ID,
        roles: ['VRO5--Owner']
      })
    })
  })

  const get = (token, url = '/v1/catch-records') =>
    server.inject({
      method: 'GET',
      url,
      headers: token ? { authorization: `Bearer ${token}` } : {}
    })

  test('Should register no legacy authentication strategy and no dual-mode switch', () => {
    expect(() =>
      server.route({
        method: 'GET',
        path: '/legacy-probe',
        options: { auth: 'authentication-service' },
        handler: () => 'ok'
      })
    ).toThrow()
    expect(config.has('authentication')).toBe(false)
  })

  test('Should authenticate every protected route with the Entra strategy only', () => {
    const protectedRoutes = server
      .table()
      .filter((route) => route.settings.auth)

    expect(protectedRoutes.length).toBeGreaterThan(0)
    for (const route of protectedRoutes) {
      expect(route.settings.auth.strategies).toEqual(['entra-bearer'])
    }
  })

  test.each(FIXED_TOKENS)(
    'Should reject the fixed legacy token %s without any downstream call',
    async (token) => {
      const response = await get(token)

      expect(response.statusCode).toBe(401)
      expect(response.headers['www-authenticate']).toBe('Bearer')
      expect(userProfileCalls).toEqual([])
    }
  )

  test.each([
    ['an arbitrary static string', 'some-static-string'],
    [
      'a base64 string that is not a JWT',
      Buffer.from('user-1').toString('base64')
    ],
    ['a three-part non-JWT', 'a.b.c']
  ])('Should reject %s', async (_name, token) => {
    expect((await get(token)).statusCode).toBe(401)
  })

  test('Should reject a missing credential and a non-bearer scheme', async () => {
    const none = await get(null)
    const basic = await server.inject({
      url: '/v1/catch-records',
      headers: { authorization: 'Basic cmVhZC10b2tlbg==' }
    })

    expect([none.statusCode, basic.statusCode]).toEqual([401, 401])
  })

  test('Should reject tokens signed with an unknown key, an unsigned token and one for another audience', async () => {
    const stranger = await createTestSigningKey('kid-server-test')
    const wrongKey = await signTestToken(stranger, { claims: { oid: USER_ID } })
    const wrongAudience = await signTestToken(signing, {
      claims: { aud: 'api://another-api', oid: USER_ID }
    })
    const unsigned = `${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from('{}').toString('base64url')}.`

    for (const token of [wrongKey, wrongAudience, unsigned]) {
      expect((await get(token)).statusCode).toBe(401)
    }
  })

  test('Should authorize a valid signed token via roles and definitions from the User Profile Service only', async () => {
    const token = await signTestToken(signing, {
      claims: {
        oid: USER_ID,
        roles: ['Admin'],
        scp: 'everything',
        groups: ['g']
      }
    })

    const response = await get(token)

    expect(response.statusCode).toBe(200)
    expect(
      userProfileCalls.some((url) => url.includes(`/users/${USER_ID}/roles`))
    ).toBe(true)
    expect(
      userProfileCalls.some((url) =>
        url.includes('/roles-definitions/services/catch-recording')
      )
    ).toBe(true)
    const forwarded = fetchMock.mock.calls
      .map(([, init]) => JSON.stringify(init?.headers ?? {}))
      .join('')
    expect(forwarded).not.toContain(token)
  })

  test('Should ignore token roles, scopes and groups: a token claiming Admin gets nothing without assigned roles', async () => {
    fetchMock.mockResponse(async (request) => {
      const { url } = request
      const ok = (body) => ({
        body: JSON.stringify(body),
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
      if (url === config.get('entra.oidcMetadataUrl')) {
        return ok({
          issuer: config.get('entra.issuer'),
          jwks_uri: TEST_JWKS_URI
        })
      }
      if (url === TEST_JWKS_URI) {
        return ok({ keys: [signing.publicJwk] })
      }
      return url.includes('/roles-definitions/')
        ? ok({
            schemaVersion: '1.0',
            definitionsVersion: '1',
            serviceId: 'catch-recording',
            roles: [{ roleId: 'Admin', capabilityIds: ['catch-record.read'] }]
          })
        : ok({
            schemaVersion: '1.0',
            definitionsVersion: '1',
            userId: 'no-roles-user',
            roles: []
          })
    })
    const token = await signTestToken(signing, {
      claims: {
        oid: 'no-roles-user',
        roles: ['Admin'],
        scp: 'catch-record.read'
      }
    })

    expect((await get(token)).statusCode).toBe(403)
  })

  test('Should keep public endpoints unauthenticated', async () => {
    expect((await server.inject({ url: '/health' })).statusCode).toBe(200)
  })

  test('Should not accept a token whose key is only reachable through a token-supplied URL', async () => {
    const token = await new SignJWT({
      oid: USER_ID,
      iss: config.get('entra.issuer'),
      aud: config.get('entra.audience')
    })
      .setProtectedHeader({
        alg: 'RS256',
        kid: 'kid-unknown',
        jku: 'https://attacker.invalid/jwks'
      })
      .setExpirationTime('1h')
      .sign(signing.privateKey)

    const response = await get(token)

    expect(response.statusCode).toBe(401)
    expect(
      fetchMock.mock.calls.some(([url]) =>
        String(url).includes('attacker.invalid')
      )
    ).toBe(false)
  })
})
