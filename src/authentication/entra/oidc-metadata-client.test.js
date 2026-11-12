import {
  createFetchStub,
  TEST_ISSUER,
  TEST_JWKS_URI,
  TEST_METADATA_URL
} from './entra-test-fixtures.js'
import { createOidcMetadataClient } from './oidc-metadata-client.js'
import { SigningKeyFailure } from './signing-key-failure.js'

const clientFor = (json, overrides = {}) =>
  createOidcMetadataClient({
    metadataUrl: TEST_METADATA_URL,
    expectedIssuer: TEST_ISSUER,
    timeoutMs: 1000,
    fetchFn: createFetchStub({ [TEST_METADATA_URL]: { json } }),
    ...overrides
  })

describe('#createOidcMetadataClient', () => {
  test('Should return the validated issuer and jwks_uri from the configured metadata URL', async () => {
    const client = clientFor({ issuer: TEST_ISSUER, jwks_uri: TEST_JWKS_URI })

    const metadata = await client.fetchMetadata()

    expect(metadata).toEqual({ issuer: TEST_ISSUER, jwksUri: TEST_JWKS_URI })
    expect(Object.isFrozen(metadata)).toBe(true)
  })

  test('Should reject metadata whose issuer differs from the configured issuer', async () => {
    const client = clientFor({
      issuer: `${TEST_ISSUER}/`,
      jwks_uri: TEST_JWKS_URI
    })

    await expect(client.fetchMetadata()).rejects.toMatchObject({
      reason: SigningKeyFailure.METADATA_ISSUER_MISMATCH
    })
  })

  test.each([
    ['null', null],
    ['an array', []],
    ['a missing issuer', { jwks_uri: TEST_JWKS_URI }],
    ['an empty issuer', { issuer: '', jwks_uri: TEST_JWKS_URI }],
    ['a missing jwks_uri', { issuer: TEST_ISSUER }],
    ['a non-string jwks_uri', { issuer: TEST_ISSUER, jwks_uri: 7 }],
    ['an unparsable jwks_uri', { issuer: TEST_ISSUER, jwks_uri: 'nope' }],
    [
      'an http jwks_uri',
      { issuer: TEST_ISSUER, jwks_uri: 'http://login.entra.test.invalid/keys' }
    ],
    [
      'a jwks_uri with credentials',
      {
        issuer: TEST_ISSUER,
        jwks_uri: 'https://u:p@login.entra.test.invalid/k'
      }
    ]
  ])('Should reject metadata with %s as invalid', async (_name, json) => {
    await expect(clientFor(json).fetchMetadata()).rejects.toMatchObject({
      reason: SigningKeyFailure.METADATA_INVALID
    })
  })

  test('Should accept an http jwks_uri only when explicitly allowed for local development', async () => {
    const client = clientFor(
      { issuer: TEST_ISSUER, jwks_uri: 'http://localhost:3010/keys' },
      { allowHttp: true }
    )

    await expect(client.fetchMetadata()).resolves.toMatchObject({
      jwksUri: 'http://localhost:3010/keys'
    })
  })

  test('Should only ever request the configured metadata URL', async () => {
    const fetchFn = createFetchStub({
      [TEST_METADATA_URL]: {
        json: { issuer: TEST_ISSUER, jwks_uri: TEST_JWKS_URI }
      }
    })

    await clientFor(null, { fetchFn }).fetchMetadata()

    expect(fetchFn.calls.map((call) => call.url)).toEqual([TEST_METADATA_URL])
  })
})
