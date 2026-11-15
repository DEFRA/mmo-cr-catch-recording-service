import { exportJWK, generateKeyPair } from 'jose'

import {
  createFetchStub,
  createTestSigningKey,
  TEST_JWKS_URI
} from './entra-test-fixtures.js'
import { createJwksClient } from './jwks-client.js'
import { SigningKeyFailure } from './signing-key-failure.js'

const clientFor = (json, overrides = {}) =>
  createJwksClient({
    timeoutMs: 1000,
    allowedAlgorithms: ['RS256'],
    fetchFn: createFetchStub({ [TEST_JWKS_URI]: { json } }),
    ...overrides
  })

describe('#createJwksClient', () => {
  let keyA
  let keyB

  beforeAll(async () => {
    keyA = await createTestSigningKey('kid-a')
    keyB = await createTestSigningKey('kid-b')
  })

  test('Should return verification keys indexed by exact kid', async () => {
    const keys = await clientFor({
      keys: [keyA.publicJwk, keyB.publicJwk]
    }).fetchSigningKeys(TEST_JWKS_URI)

    expect([...keys.keys()]).toEqual(['kid-a', 'kid-b'])
    expect(keys.get('kid-a').type).toBe('public')
  })

  test('Should ignore unusable keys without selecting them as a fallback', async () => {
    const ecKey = await generateKeyPair('ES256', { extractable: true })
    const smallKey = await createTestSigningKey('kid-small', {
      modulusLength: 1024
    })
    const privateJwk = {
      ...(await exportJWK((await createTestSigningKey('kid-priv')).privateKey)),
      kid: 'kid-priv'
    }
    const keys = await clientFor({
      keys: [
        keyA.publicJwk,
        { ...(await exportJWK(ecKey.publicKey)), kid: 'kid-ec' },
        smallKey.publicJwk,
        privateJwk,
        { ...keyB.publicJwk, kid: '' },
        { ...keyB.publicJwk, kid: undefined },
        { ...keyB.publicJwk, kid: 'kid-enc', use: 'enc' },
        { ...keyB.publicJwk, kid: 'kid-alg', alg: 'HS256' },
        { ...keyB.publicJwk, kid: 'kid-ops', key_ops: ['encrypt'] },
        { ...keyB.publicJwk, kid: 'kid-bad-n', n: '!!!' },
        { ...keyB.publicJwk, kid: 'kid-bad-e', e: 'AA' },
        { ...keyB.publicJwk, kid: 'kid-e-one', e: 'AQ' },
        { ...keyB.publicJwk, kid: 'kid-e-empty', e: '' },
        'not-an-object'
      ]
    }).fetchSigningKeys(TEST_JWKS_URI)

    expect([...keys.keys()]).toEqual(['kid-a'])
  })

  test('Should accept a key that declares signing use, the allowed algorithm and verify operations', async () => {
    const keys = await clientFor({
      keys: [{ ...keyA.publicJwk, alg: 'RS256', key_ops: ['verify'] }]
    }).fetchSigningKeys(TEST_JWKS_URI)

    expect([...keys.keys()]).toEqual(['kid-a'])
  })

  test('Should reject a key set containing duplicate kid values', async () => {
    await expect(
      clientFor({ keys: [keyA.publicJwk, keyA.publicJwk] }).fetchSigningKeys(
        TEST_JWKS_URI
      )
    ).rejects.toMatchObject({ reason: SigningKeyFailure.JWKS_INVALID })
  })

  test.each([
    ['an array root', []],
    ['a missing keys collection', {}],
    ['a non-array keys collection', { keys: {} }],
    ['an unreasonably large key set', { keys: new Array(21).fill({}) }]
  ])('Should reject %s as invalid', async (_name, json) => {
    await expect(
      clientFor(json).fetchSigningKeys(TEST_JWKS_URI)
    ).rejects.toMatchObject({ reason: SigningKeyFailure.JWKS_INVALID })
  })

  test('Should report no usable signing keys for an empty or wholly unusable key set', async () => {
    await expect(
      clientFor({ keys: [] }).fetchSigningKeys(TEST_JWKS_URI)
    ).rejects.toMatchObject({
      reason: SigningKeyFailure.NO_USABLE_SIGNING_KEYS
    })
  })

  test('Should report JWKS unavailable when the endpoint fails', async () => {
    const client = clientFor(null, {
      fetchFn: createFetchStub({ [TEST_JWKS_URI]: { status: 503 } })
    })

    await expect(client.fetchSigningKeys(TEST_JWKS_URI)).rejects.toMatchObject({
      reason: SigningKeyFailure.JWKS_UNAVAILABLE
    })
  })
})
