import Hapi from '@hapi/hapi'
import { jwtVerify, SignJWT } from 'jose'

import {
  createEntraSigningKeyProvider,
  entraSigningKeys
} from './entra-signing-keys.js'
import {
  createFetchStub,
  createTestSigningKey,
  TEST_ISSUER,
  TEST_JWKS_URI,
  TEST_METADATA_URL
} from '#/authentication/entra/entra-test-fixtures.js'

const entraConfig = {
  issuer: TEST_ISSUER,
  oidcMetadataUrl: TEST_METADATA_URL,
  allowedAlgorithms: ['RS256'],
  metadataRefreshIntervalSeconds: 3600,
  minimumRefreshIntervalSeconds: 60,
  requestTimeoutMs: 1000
}

describe('#entraSigningKeys', () => {
  test('Should resolve a real signing key from metadata and JWKS that verifies a signed token', async () => {
    const signing = await createTestSigningKey('kid-1')
    const fetchFn = createFetchStub({
      [TEST_METADATA_URL]: {
        json: { issuer: TEST_ISSUER, jwks_uri: TEST_JWKS_URI }
      },
      [TEST_JWKS_URI]: { json: { keys: [signing.publicJwk] } }
    })
    const provider = createEntraSigningKeyProvider({
      entra: entraConfig,
      fetchFn
    })
    const token = await new SignJWT({ sample: true })
      .setProtectedHeader({ alg: 'RS256', kid: 'kid-1' })
      .sign(signing.privateKey)

    const result = await provider.getSigningKey('kid-1')

    expect(result.ok).toBe(true)
    await expect(
      jwtVerify(token, result.key, { algorithms: ['RS256'] })
    ).resolves.toBeDefined()
  })

  test('Should return no provider when Entra is not configured', () => {
    expect(
      createEntraSigningKeyProvider({
        entra: { ...entraConfig, issuer: null, oidcMetadataUrl: null }
      })
    ).toBeNull()
  })

  test('Should decorate the server with one shared lazily-loaded provider and make no request at registration', async () => {
    const fetchFn = createFetchStub({})
    const server = Hapi.server()
    server.logger = { warn: () => {}, debug: () => {} }

    await server.register({
      plugin: entraSigningKeys,
      options: { entra: entraConfig, fetchFn }
    })

    expect(server.entraSigningKeyProvider.getSigningKey).toBeInstanceOf(
      Function
    )
    expect(fetchFn.calls).toHaveLength(0)
  })

  test('Should decorate the server with null when Entra is not configured', async () => {
    const server = Hapi.server()
    server.logger = { warn: () => {}, debug: () => {} }

    await server.register({
      plugin: entraSigningKeys,
      options: { entra: { ...entraConfig, issuer: null } }
    })

    expect(server.entraSigningKeyProvider).toBeNull()
  })
})
