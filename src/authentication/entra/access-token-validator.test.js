import { vi } from 'vitest'
import { SignJWT } from 'jose'

import {
  AccessTokenFailure,
  createAccessTokenValidator,
  FailureSource
} from './access-token-validator.js'
import { createJwksClient } from './jwks-client.js'
import { createOidcMetadataClient } from './oidc-metadata-client.js'
import { createSigningKeyProvider } from './signing-key-provider.js'
import {
  createFetchStub,
  createTestSigningKey,
  signTestToken,
  TEST_AUDIENCE,
  TEST_ISSUER,
  TEST_JWKS_URI,
  TEST_METADATA_URL
} from './entra-test-fixtures.js'
import { SigningKeyFailure } from './signing-key-failure.js'

const NOW = new Date('2026-01-01T12:00:00Z')

const bearer = (token) => `Bearer ${token}`
const staticProvider = (keys) => ({
  getSigningKey: vi.fn(async (keyId) =>
    keys[keyId]
      ? { ok: true, keyId, key: keys[keyId].publicKey }
      : { ok: false, reason: SigningKeyFailure.KEY_NOT_FOUND }
  )
})

describe('#createAccessTokenValidator', () => {
  let signing
  let otherSigning
  let validatorFor

  beforeAll(async () => {
    signing = await createTestSigningKey('kid-1')
    otherSigning = await createTestSigningKey('kid-1')
  })

  beforeEach(() => {
    validatorFor = (overrides = {}) =>
      createAccessTokenValidator({
        signingKeyProvider: staticProvider({ 'kid-1': signing }),
        issuer: TEST_ISSUER,
        audience: TEST_AUDIENCE,
        allowedAlgorithms: ['RS256'],
        now: () => NOW,
        ...overrides
      })
  })

  const expectFailure = async (header, reason, source, overrides) => {
    await expect(validatorFor(overrides).validate(header)).resolves.toEqual({
      ok: false,
      reason,
      source
    })
  }

  describe('valid tokens', () => {
    test('Should return the immutable validated claims and nothing else for a valid token', async () => {
      const token = await signTestToken(signing, {
        now: NOW,
        claims: { aud: [TEST_AUDIENCE, 'api://other'], nested: { a: 1 } }
      })

      const result = await validatorFor().validate(bearer(token))

      expect(result.ok).toBe(true)
      expect(Object.keys(result).sort()).toEqual(['claims', 'ok'])
      expect(result.claims.iss).toBe(TEST_ISSUER)
      expect(Object.isFrozen(result)).toBe(true)
      expect(Object.isFrozen(result.claims)).toBe(true)
      expect(Object.isFrozen(result.claims.nested)).toBe(true)
      expect(Object.isFrozen(result.claims.aud)).toBe(true)
      expect(JSON.stringify(result)).not.toContain(token)
    })

    test('Should accept a token without not-before', async () => {
      const token = await signTestToken(signing, {
        now: NOW,
        claims: { nbf: undefined }
      })

      await expect(
        validatorFor().validate(bearer(token))
      ).resolves.toMatchObject({ ok: true })
    })

    test('Should pass the exact kid only to the signing-key provider', async () => {
      const provider = staticProvider({ 'kid-1': signing })
      const token = await signTestToken(signing, { now: NOW })

      await validatorFor({ signingKeyProvider: provider }).validate(
        bearer(token)
      )

      expect(provider.getSigningKey).toHaveBeenCalledWith('kid-1', {
        signal: undefined
      })
    })
  })

  describe('authorization header and token structure', () => {
    test.each([
      [undefined, AccessTokenFailure.MISSING_AUTHORIZATION_HEADER],
      ['', AccessTokenFailure.MISSING_AUTHORIZATION_HEADER],
      ['Basic abc', AccessTokenFailure.UNSUPPORTED_AUTHENTICATION_SCHEME],
      ['Bearer ', AccessTokenFailure.MALFORMED_AUTHORIZATION_HEADER],
      ['Bearer not-a-jwt', AccessTokenFailure.MALFORMED_TOKEN],
      ['Bearer a.b.c', AccessTokenFailure.MALFORMED_TOKEN]
    ])('Should reject the header %j', async (header, reason) => {
      await expectFailure(header, reason, FailureSource.CREDENTIALS)
    })

    test('Should reject a token with a missing key identifier without selecting a key', async () => {
      const provider = staticProvider({ 'kid-1': signing })
      const token = await new SignJWT({ iss: TEST_ISSUER })
        .setProtectedHeader({ alg: 'RS256' })
        .sign(signing.privateKey)

      await expectFailure(
        bearer(token),
        AccessTokenFailure.MISSING_KEY_ID,
        FailureSource.CREDENTIALS,
        { signingKeyProvider: provider }
      )
      expect(provider.getSigningKey).not.toHaveBeenCalled()
    })

    test.each([['none'], ['HS256'], ['PS256'], ['RS512']])(
      'Should reject the disallowed header algorithm %s before any key lookup',
      async (alg) => {
        const provider = staticProvider({ 'kid-1': signing })
        const header = Buffer.from(
          JSON.stringify({ alg, kid: 'kid-1' })
        ).toString('base64url')
        const token = `${header}.${Buffer.from('{}').toString('base64url')}.c2ln`

        await expectFailure(
          bearer(token),
          AccessTokenFailure.DISALLOWED_ALGORITHM,
          FailureSource.CREDENTIALS,
          { signingKeyProvider: provider }
        )
        expect(provider.getSigningKey).not.toHaveBeenCalled()
      }
    )

    test('Should reject an unsigned token', async () => {
      const unsigned = `${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from(`{"iss":"${TEST_ISSUER}"}`).toString('base64url')}.`

      await expectFailure(
        bearer(unsigned),
        AccessTokenFailure.DISALLOWED_ALGORITHM,
        FailureSource.CREDENTIALS
      )
    })

    test('Should ignore token-supplied key locations such as jku', async () => {
      const token = await signTestToken(signing, {
        now: NOW,
        header: {
          jku: 'https://attacker.invalid/keys',
          x5u: 'https://x.invalid'
        }
      })

      const result = await validatorFor().validate(bearer(token))

      expect(result.ok).toBe(true)
    })
  })

  describe('signing keys', () => {
    test('Should reject an unknown kid as a credential failure', async () => {
      const token = await signTestToken(signing, {
        now: NOW,
        header: { kid: 'kid-unknown' }
      })

      await expectFailure(
        bearer(token),
        AccessTokenFailure.SIGNING_KEY_NOT_FOUND,
        FailureSource.CREDENTIALS
      )
    })

    test('Should treat a throttled lookup with no earlier dependency failure as an unknown key', async () => {
      const provider = {
        getSigningKey: async () => ({
          ok: false,
          reason: SigningKeyFailure.REFRESH_THROTTLED,
          lastRefreshFailure: null
        })
      }
      const token = await signTestToken(signing, { now: NOW })

      await expectFailure(
        bearer(token),
        AccessTokenFailure.SIGNING_KEY_NOT_FOUND,
        FailureSource.CREDENTIALS,
        { signingKeyProvider: provider }
      )
    })

    test.each([
      [{ reason: SigningKeyFailure.JWKS_UNAVAILABLE }],
      [{ reason: SigningKeyFailure.METADATA_UNAVAILABLE }],
      [{ reason: SigningKeyFailure.REQUEST_TIMEOUT }],
      [{ reason: SigningKeyFailure.INTERNAL_ERROR }],
      [
        {
          reason: SigningKeyFailure.REFRESH_THROTTLED,
          lastRefreshFailure: SigningKeyFailure.JWKS_UNAVAILABLE
        }
      ]
    ])(
      'Should keep the key dependency failure %j distinguishable from invalid credentials',
      async (keyFailure) => {
        const provider = {
          getSigningKey: async () => ({ ok: false, ...keyFailure })
        }
        const token = await signTestToken(signing, { now: NOW })

        await expectFailure(
          bearer(token),
          AccessTokenFailure.SIGNING_KEY_UNAVAILABLE,
          FailureSource.DEPENDENCY,
          { signingKeyProvider: provider }
        )
      }
    )

    test('Should fail closed when Entra is not configured', async () => {
      const token = await signTestToken(signing, { now: NOW })

      await expectFailure(
        bearer(token),
        AccessTokenFailure.AUTHENTICATION_NOT_CONFIGURED,
        FailureSource.DEPENDENCY,
        { signingKeyProvider: null }
      )
    })

    test('Should reject a token signed by a different key that shares the kid', async () => {
      const token = await signTestToken(otherSigning, { now: NOW })

      await expectFailure(
        bearer(token),
        AccessTokenFailure.INVALID_SIGNATURE,
        FailureSource.CREDENTIALS
      )
    })

    test('Should reject a token whose payload was tampered with', async () => {
      const token = await signTestToken(signing, { now: NOW })
      const [header, , signature] = token.split('.')
      const payload = Buffer.from(
        JSON.stringify({
          iss: TEST_ISSUER,
          aud: TEST_AUDIENCE,
          exp: 9999999999
        })
      ).toString('base64url')

      await expectFailure(
        bearer(`${header}.${payload}.${signature}`),
        AccessTokenFailure.INVALID_SIGNATURE,
        FailureSource.CREDENTIALS
      )
    })

    test('Should validate a token signed with a rolled-over key after one controlled refresh', async () => {
      const newSigning = await createTestSigningKey('kid-rolled')
      let published = [signing.publicJwk]
      const fetchFn = createFetchStub({
        [TEST_METADATA_URL]: {
          json: { issuer: TEST_ISSUER, jwks_uri: TEST_JWKS_URI }
        },
        [TEST_JWKS_URI]: () => ({ json: { keys: published } })
      })
      const clock = { time: 0 }
      const provider = createSigningKeyProvider({
        metadataClient: createOidcMetadataClient({
          metadataUrl: TEST_METADATA_URL,
          expectedIssuer: TEST_ISSUER,
          timeoutMs: 1000,
          fetchFn
        }),
        jwksClient: createJwksClient({
          timeoutMs: 1000,
          allowedAlgorithms: ['RS256'],
          fetchFn
        }),
        refreshIntervalSeconds: 3600,
        minimumRefreshIntervalSeconds: 60,
        now: () => clock.time
      })
      const validator = validatorFor({ signingKeyProvider: provider })
      const oldToken = await signTestToken(signing, { now: NOW })
      await expect(validator.validate(bearer(oldToken))).resolves.toMatchObject(
        { ok: true }
      )

      published = [signing.publicJwk, newSigning.publicJwk]
      clock.time += 60_000
      const rolledToken = await signTestToken(newSigning, { now: NOW })

      await expect(
        validator.validate(bearer(rolledToken))
      ).resolves.toMatchObject({ ok: true })
      expect(fetchFn.countFor(TEST_JWKS_URI)).toBe(2)
    })
  })

  describe('claims', () => {
    test.each([
      [{ iss: undefined }, AccessTokenFailure.MISSING_ISSUER],
      [{ iss: `${TEST_ISSUER}/` }, AccessTokenFailure.INVALID_ISSUER],
      [{ iss: TEST_ISSUER.toUpperCase() }, AccessTokenFailure.INVALID_ISSUER],
      [{ iss: `${TEST_ISSUER}.attacker` }, AccessTokenFailure.INVALID_ISSUER],
      [{ iss: ['a'] }, AccessTokenFailure.INVALID_ISSUER],
      [{ aud: undefined }, AccessTokenFailure.MISSING_AUDIENCE],
      [{ aud: 'api://other' }, AccessTokenFailure.INVALID_AUDIENCE],
      [{ aud: `${TEST_AUDIENCE}-x` }, AccessTokenFailure.INVALID_AUDIENCE],
      [{ aud: [] }, AccessTokenFailure.INVALID_AUDIENCE],
      [
        { aud: ['api://other', 'api://another'] },
        AccessTokenFailure.INVALID_AUDIENCE
      ],
      [{ exp: undefined }, AccessTokenFailure.MISSING_REQUIRED_CLAIM],
      [{ exp: 'soon' }, AccessTokenFailure.MALFORMED_TIME_CLAIM],
      [{ nbf: 'later' }, AccessTokenFailure.MALFORMED_TIME_CLAIM]
    ])('Should reject the claims %j', async (claims, reason) => {
      const token = await signTestToken(signing, { now: NOW, claims })

      await expectFailure(bearer(token), reason, FailureSource.CREDENTIALS)
    })

    test('Should reject an expired token', async () => {
      const token = await signTestToken(signing, { now: NOW, expiresIn: -1 })

      await expectFailure(
        bearer(token),
        AccessTokenFailure.EXPIRED_TOKEN,
        FailureSource.CREDENTIALS
      )
    })

    test('Should reject a token that is not yet valid', async () => {
      const token = await signTestToken(signing, { now: NOW, notBefore: 30 })

      await expectFailure(
        bearer(token),
        AccessTokenFailure.TOKEN_NOT_YET_VALID,
        FailureSource.CREDENTIALS
      )
    })

    test('Should apply only the explicitly configured bounded clock tolerance', async () => {
      const slightlyEarly = await signTestToken(signing, {
        now: NOW,
        notBefore: 30
      })
      const slightlyExpired = await signTestToken(signing, {
        now: NOW,
        expiresIn: -30
      })
      const tolerant = validatorFor({ clockToleranceSeconds: 60 })

      await expect(
        tolerant.validate(bearer(slightlyEarly))
      ).resolves.toMatchObject({ ok: true })
      await expect(
        tolerant.validate(bearer(slightlyExpired))
      ).resolves.toMatchObject({ ok: true })
      await expect(
        validatorFor().validate(bearer(slightlyExpired))
      ).resolves.toMatchObject({ ok: false })
    })

    test('Should report an unexpected library failure as an internal failure', async () => {
      const provider = {
        getSigningKey: async () => ({
          ok: true,
          keyId: 'kid-1',
          key: 'not-a-key'
        })
      }
      const token = await signTestToken(signing, { now: NOW })

      await expectFailure(
        bearer(token),
        AccessTokenFailure.UNEXPECTED_VALIDATION_FAILURE,
        FailureSource.INTERNAL,
        { signingKeyProvider: provider }
      )
    })
  })

  test('Should never include the token or claims in a failure result', async () => {
    const token = await signTestToken(signing, { now: NOW, expiresIn: -10 })

    const result = await validatorFor().validate(bearer(token))

    expect(JSON.stringify(result)).not.toContain(token.split('.')[1])
    expect(Object.keys(result).sort()).toEqual(['ok', 'reason', 'source'])
  })
})
