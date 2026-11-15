import { vi } from 'vitest'

import { SigningKeyError, SigningKeyFailure } from './signing-key-failure.js'
import { createSigningKeyProvider } from './signing-key-provider.js'

const REFRESH_INTERVAL_SECONDS = 3600
const MINIMUM_INTERVAL_SECONDS = 60
const METADATA = {
  issuer: 'https://issuer.test.invalid',
  jwksUri: 'https://k.test.invalid'
}

function createHarness({ keySets }) {
  const clock = { time: 1_000_000 }
  const queue = [...keySets]
  const metadataClient = { fetchMetadata: vi.fn(async () => METADATA) }
  const jwksClient = {
    fetchSigningKeys: vi.fn(async () => {
      const next = queue.length > 1 ? queue.shift() : queue[0]
      if (next instanceof Error) {
        throw next
      }
      return new Map(Object.entries(next))
    })
  }
  const logger = { warn: vi.fn(), debug: vi.fn() }
  const provider = createSigningKeyProvider({
    metadataClient,
    jwksClient,
    refreshIntervalSeconds: REFRESH_INTERVAL_SECONDS,
    minimumRefreshIntervalSeconds: MINIMUM_INTERVAL_SECONDS,
    now: () => clock.time,
    logger
  })
  const advance = (seconds) => {
    clock.time += seconds * 1000
  }

  return { provider, metadataClient, jwksClient, logger, advance }
}

const failure = (reason) => new SigningKeyError(reason)

describe('#createSigningKeyProvider', () => {
  test('Should load lazily on first use and serve a known kid from the snapshot without further requests', async () => {
    const { provider, metadataClient } = createHarness({
      keySets: [{ 'kid-a': 'key-a' }]
    })

    expect(metadataClient.fetchMetadata).not.toHaveBeenCalled()
    await expect(provider.getSigningKey('kid-a')).resolves.toEqual({
      ok: true,
      keyId: 'kid-a',
      key: 'key-a'
    })
    await provider.getSigningKey('kid-a')

    expect(metadataClient.fetchMetadata).toHaveBeenCalledTimes(1)
  })

  test.each([[''], [undefined], [null], [42]])(
    'Should never refresh or select a key for the invalid kid %j',
    async (keyId) => {
      const { provider, metadataClient } = createHarness({
        keySets: [{ 'kid-a': 'key-a' }]
      })

      await expect(provider.getSigningKey(keyId)).resolves.toEqual({
        ok: false,
        reason: SigningKeyFailure.KEY_NOT_FOUND,
        refreshAttempted: false
      })
      expect(metadataClient.fetchMetadata).not.toHaveBeenCalled()
    }
  )

  test('Should refresh once for an unknown kid and retry the lookup once', async () => {
    const { provider, metadataClient, advance } = createHarness({
      keySets: [{ 'kid-a': 'key-a' }, { 'kid-a': 'key-a', 'kid-b': 'key-b' }]
    })
    await provider.getSigningKey('kid-a')
    advance(MINIMUM_INTERVAL_SECONDS)

    const result = await provider.getSigningKey('kid-b')

    expect(result).toMatchObject({ ok: true, key: 'key-b' })
    expect(metadataClient.fetchMetadata).toHaveBeenCalledTimes(2)
  })

  test('Should report key-not-found after exactly one refresh when the kid remains unknown', async () => {
    const { provider, metadataClient, advance } = createHarness({
      keySets: [{ 'kid-a': 'key-a' }]
    })
    await provider.getSigningKey('kid-a')
    advance(MINIMUM_INTERVAL_SECONDS)

    const result = await provider.getSigningKey('kid-unknown')

    expect(result).toEqual({
      ok: false,
      reason: SigningKeyFailure.KEY_NOT_FOUND,
      refreshAttempted: true
    })
    expect(metadataClient.fetchMetadata).toHaveBeenCalledTimes(2)
  })

  test('Should not cause a refresh storm for repeated unknown kids inside the minimum interval', async () => {
    const { provider, metadataClient, advance } = createHarness({
      keySets: [{ 'kid-a': 'key-a' }]
    })
    await provider.getSigningKey('kid-a')
    advance(MINIMUM_INTERVAL_SECONDS)
    await provider.getSigningKey('unknown-1')

    const throttled = await provider.getSigningKey('unknown-2')

    expect(throttled).toMatchObject({
      ok: false,
      reason: SigningKeyFailure.REFRESH_THROTTLED,
      refreshAttempted: false
    })
    expect(metadataClient.fetchMetadata).toHaveBeenCalledTimes(2)

    advance(MINIMUM_INTERVAL_SECONDS)
    await provider.getSigningKey('unknown-3')
    expect(metadataClient.fetchMetadata).toHaveBeenCalledTimes(3)
  })

  test('Should coalesce concurrent lookups into a single refresh', async () => {
    const { provider, metadataClient, jwksClient } = createHarness({
      keySets: [{ 'kid-a': 'key-a' }]
    })

    const results = await Promise.all([
      provider.getSigningKey('kid-a'),
      provider.getSigningKey('kid-a'),
      provider.getSigningKey('kid-unknown'),
      provider.getSigningKey('kid-a')
    ])

    expect(results.map((result) => result.ok)).toEqual([
      true,
      true,
      false,
      true
    ])
    expect(metadataClient.fetchMetadata).toHaveBeenCalledTimes(1)
    expect(jwksClient.fetchSigningKeys).toHaveBeenCalledTimes(1)
  })

  test('Should refresh a snapshot that is due and replace it atomically', async () => {
    const { provider, metadataClient, advance } = createHarness({
      keySets: [{ 'kid-a': 'key-a' }, { 'kid-a': 'key-a2', 'kid-c': 'key-c' }]
    })
    await provider.getSigningKey('kid-a')
    advance(REFRESH_INTERVAL_SECONDS)

    await expect(provider.getSigningKey('kid-a')).resolves.toMatchObject({
      key: 'key-a2'
    })
    await expect(provider.getSigningKey('kid-c')).resolves.toMatchObject({
      ok: true
    })
    expect(metadataClient.fetchMetadata).toHaveBeenCalledTimes(2)
  })

  test('Should stop resolving a key that a successful refresh retired', async () => {
    const { provider, advance } = createHarness({
      keySets: [{ 'kid-old': 'key-old' }, { 'kid-new': 'key-new' }]
    })
    await provider.getSigningKey('kid-old')
    advance(REFRESH_INTERVAL_SECONDS)

    await expect(provider.getSigningKey('kid-old')).resolves.toMatchObject({
      ok: false,
      reason: SigningKeyFailure.KEY_NOT_FOUND
    })
  })

  test.each([
    ['unavailable', failure(SigningKeyFailure.JWKS_UNAVAILABLE)],
    ['no usable keys', failure(SigningKeyFailure.NO_USABLE_SIGNING_KEYS)],
    ['an unexpected error', new Error('boom')]
  ])(
    'Should preserve the previous valid snapshot when a due refresh fails with %s',
    async (_name, error) => {
      const { provider, advance, logger } = createHarness({
        keySets: [{ 'kid-a': 'key-a' }, error]
      })
      await provider.getSigningKey('kid-a')
      advance(REFRESH_INTERVAL_SECONDS)

      await expect(provider.getSigningKey('kid-a')).resolves.toMatchObject({
        ok: true,
        key: 'key-a'
      })
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'oidc.refresh', outcome: 'failure' }),
        expect.any(String)
      )
    }
  )

  test('Should not extend a due snapshot because a refresh failed, and retry after the minimum interval', async () => {
    const { provider, jwksClient, advance } = createHarness({
      keySets: [
        { 'kid-a': 'key-a' },
        failure(SigningKeyFailure.JWKS_UNAVAILABLE),
        { 'kid-a': 'key-a3' }
      ]
    })
    await provider.getSigningKey('kid-a')
    advance(REFRESH_INTERVAL_SECONDS)
    await provider.getSigningKey('kid-a')
    expect(jwksClient.fetchSigningKeys).toHaveBeenCalledTimes(2)

    await provider.getSigningKey('kid-a')
    expect(jwksClient.fetchSigningKeys).toHaveBeenCalledTimes(2)

    advance(MINIMUM_INTERVAL_SECONDS)
    await expect(provider.getSigningKey('kid-a')).resolves.toMatchObject({
      key: 'key-a3'
    })
  })

  test('Should surface the dependency failure when an unknown kid cannot be resolved because refresh failed', async () => {
    const { provider, advance } = createHarness({
      keySets: [
        { 'kid-a': 'key-a' },
        failure(SigningKeyFailure.METADATA_UNAVAILABLE)
      ]
    })
    await provider.getSigningKey('kid-a')
    advance(MINIMUM_INTERVAL_SECONDS)

    await expect(provider.getSigningKey('kid-unknown')).resolves.toEqual({
      ok: false,
      reason: SigningKeyFailure.METADATA_UNAVAILABLE,
      refreshAttempted: true
    })
  })

  test('Should throttle repeated lookups after a failed initial load and report the last failure', async () => {
    const { provider, metadataClient, advance } = createHarness({
      keySets: [failure(SigningKeyFailure.JWKS_INVALID), { 'kid-a': 'key-a' }]
    })

    await expect(provider.getSigningKey('kid-a')).resolves.toMatchObject({
      ok: false,
      reason: SigningKeyFailure.JWKS_INVALID
    })
    await expect(provider.getSigningKey('kid-a')).resolves.toEqual({
      ok: false,
      reason: SigningKeyFailure.REFRESH_THROTTLED,
      lastRefreshFailure: SigningKeyFailure.JWKS_INVALID,
      refreshAttempted: false
    })
    expect(metadataClient.fetchMetadata).toHaveBeenCalledTimes(1)

    advance(MINIMUM_INTERVAL_SECONDS)
    await expect(provider.getSigningKey('kid-a')).resolves.toMatchObject({
      ok: true
    })
  })

  test('Should report an unexpected metadata client failure as an internal error', async () => {
    const harness = createHarness({ keySets: [{ 'kid-a': 'key-a' }] })
    harness.metadataClient.fetchMetadata.mockRejectedValueOnce(new Error('x'))

    await expect(
      harness.provider.getSigningKey('kid-a')
    ).resolves.toMatchObject({
      ok: false,
      reason: SigningKeyFailure.INTERNAL_ERROR
    })
  })

  test('Should release the refresh lock after a failure so a later attempt can run', async () => {
    const { provider, advance } = createHarness({
      keySets: [failure(SigningKeyFailure.METADATA_INVALID), { 'kid-a': 'k' }]
    })
    await provider.getSigningKey('kid-a')
    advance(MINIMUM_INTERVAL_SECONDS)

    await expect(provider.getSigningKey('kid-a')).resolves.toMatchObject({
      ok: true
    })
  })

  test('Should stop waiting for a cancelled caller without cancelling the shared refresh', async () => {
    const { provider, metadataClient } = createHarness({
      keySets: [{ 'kid-a': 'key-a' }]
    })
    const controller = new AbortController()

    const cancelled = provider.getSigningKey('kid-a', {
      signal: controller.signal
    })
    controller.abort()

    await expect(cancelled).resolves.toMatchObject({
      ok: false,
      reason: SigningKeyFailure.REQUEST_CANCELLED
    })
    await expect(provider.getSigningKey('kid-a')).resolves.toMatchObject({
      ok: true
    })
    expect(metadataClient.fetchMetadata).toHaveBeenCalledTimes(1)
  })

  test('Should not start any work for an already-aborted caller', async () => {
    const { provider, metadataClient } = createHarness({
      keySets: [{ 'kid-a': 'key-a' }]
    })

    await expect(
      provider.getSigningKey('kid-a', { signal: AbortSignal.abort() })
    ).resolves.toMatchObject({
      ok: false,
      reason: SigningKeyFailure.REQUEST_CANCELLED,
      refreshAttempted: false
    })
    expect(metadataClient.fetchMetadata).not.toHaveBeenCalled()
  })
})
