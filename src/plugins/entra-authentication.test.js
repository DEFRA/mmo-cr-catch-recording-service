import Hapi from '@hapi/hapi'

import { errorMapping } from '#/plugins/error-mapping.js'
import {
  entraAuthentication,
  ENTRA_AUTH_STRATEGY
} from './entra-authentication.js'
import { entraSigningKeys } from './entra-signing-keys.js'
import {
  createFetchStub,
  createTestSigningKey,
  signTestToken,
  TEST_AUDIENCE,
  TEST_ISSUER,
  TEST_JWKS_URI,
  TEST_METADATA_URL
} from '#/authentication/entra/entra-test-fixtures.js'

const entra = {
  issuer: TEST_ISSUER,
  audience: TEST_AUDIENCE,
  oidcMetadataUrl: TEST_METADATA_URL,
  allowedAlgorithms: ['RS256'],
  userIdClaim: 'oid',
  metadataRefreshIntervalSeconds: 3600,
  minimumRefreshIntervalSeconds: 60,
  requestTimeoutMs: 1000
}

async function createTestServer({ entraConfig = entra, fetchFn }) {
  const server = Hapi.server()
  server.logger = { warn: () => {}, debug: () => {} }
  await server.register([
    errorMapping,
    { plugin: entraSigningKeys, options: { entra: entraConfig, fetchFn } },
    { plugin: entraAuthentication, options: { entra: entraConfig } }
  ])
  server.route({
    method: 'GET',
    path: '/protected',
    options: { auth: ENTRA_AUTH_STRATEGY },
    handler: (request) => ({
      credentials: request.auth.credentials,
      artifacts: request.auth.artifacts ?? null
    })
  })
  server.route({
    method: 'GET',
    path: '/public',
    options: { auth: false },
    handler: () => ({ public: true })
  })
  await server.initialize()

  return server
}

describe('#entraAuthentication', () => {
  let signing
  let server
  let fetchFn

  beforeAll(async () => {
    signing = await createTestSigningKey('kid-1')
  })

  beforeEach(async () => {
    fetchFn = createFetchStub({
      [TEST_METADATA_URL]: {
        json: { issuer: TEST_ISSUER, jwks_uri: TEST_JWKS_URI }
      },
      [TEST_JWKS_URI]: { json: { keys: [signing.publicJwk] } }
    })
    server = await createTestServer({ fetchFn })
  })

  afterEach(async () => {
    await server.stop({ timeout: 0 })
  })

  const get = (authorization) =>
    server.inject({
      method: 'GET',
      url: '/protected',
      headers: authorization ? { authorization } : {}
    })

  test('Should authenticate a valid Entra access token without exposing any claim or identity', async () => {
    const token = await signTestToken(signing)

    const response = await get(`Bearer ${token}`)

    expect(response.statusCode).toBe(200)
    expect(response.result).toEqual({ credentials: {}, artifacts: null })
    expect(response.payload).not.toContain('oid')
  })

  test.each([
    ['no authorization header', undefined],
    ['a non-bearer scheme', 'Basic dXNlcjpwYXNz'],
    ['a legacy fixed mock token', 'Bearer read-token'],
    ['an arbitrary static string', 'Bearer admin-token'],
    ['a malformed JWT', 'Bearer a.b.c']
  ])(
    'Should reject %s with a generic 401 and no detail',
    async (_name, header) => {
      const response = await get(header)

      expect(response.statusCode).toBe(401)
      expect(response.payload).not.toMatch(
        /token|kid|issuer|signature|MALFORMED/i
      )
    }
  )

  test('Should reject an expired token with a generic 401', async () => {
    const token = await signTestToken(signing, { expiresIn: -10 })

    const response = await get(`Bearer ${token}`)

    expect(response.statusCode).toBe(401)
    expect(response.payload).not.toContain('EXPIRED')
  })

  test('Should reject, without a fallback identity, when the signing-key dependency is unavailable', async () => {
    await server.stop({ timeout: 0 })
    server = await createTestServer({
      fetchFn: createFetchStub({ [TEST_METADATA_URL]: { status: 503 } })
    })
    const token = await signTestToken(signing)

    const response = await get(`Bearer ${token}`)

    expect(response.statusCode).toBe(401)
  })

  test('Should reject every token when Entra is not configured (local development only)', async () => {
    await server.stop({ timeout: 0 })
    server = await createTestServer({
      entraConfig: {
        ...entra,
        issuer: null,
        audience: null,
        oidcMetadataUrl: null
      },
      fetchFn
    })
    const token = await signTestToken(signing)

    const response = await get(`Bearer ${token}`)

    expect(response.statusCode).toBe(401)
  })

  test('Should leave routes that do not opt in unauthenticated', async () => {
    const response = await server.inject({ method: 'GET', url: '/public' })

    expect(response.statusCode).toBe(200)
  })
})
