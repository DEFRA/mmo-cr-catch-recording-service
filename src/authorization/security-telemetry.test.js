import { AccessTokenFailure } from '#/authentication/entra/access-token-validator.js'
import {
  createSecurityTelemetry,
  tokenFailureCategory
} from './security-telemetry.js'

const setup = () => {
  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
  const metrics = {
    counter: vi.fn(async () => {}),
    millis: vi.fn(async () => {})
  }
  return {
    logger,
    metrics,
    telemetry: createSecurityTelemetry({ logger, metrics })
  }
}

describe('#createSecurityTelemetry', () => {
  test('Should keep only bounded, safe fields and drop everything else from the log line', () => {
    const { telemetry, logger } = setup()

    telemetry.warn(
      {
        event: 'authorization.decision',
        outcome: 'denied',
        reason: 'NO_ASSIGNED_ROLES',
        correlationId: 'trace-1',
        durationMs: 12,
        token: 'eyJ.secret.token',
        userId: 'user with spaces',
        claims: { oid: 'abc' },
        url: 'https://user-profile.internal/users/abc/roles',
        error: new Error('boom'),
        roles: ['VRO5--Owner'],
        stack: 'at x (file.js:1:1)'
      },
      'authorization.decision'
    )

    expect(logger.warn).toHaveBeenCalledWith(
      {
        event: 'authorization.decision',
        outcome: 'denied',
        reason: 'NO_ASSIGNED_ROLES',
        correlationId: 'trace-1',
        durationMs: 12
      },
      'authorization.decision'
    )
  })

  test.each([
    ['unsafe text', 'has space'],
    ['a url', 'https://x.invalid/a'],
    ['an over-long value', 'a'.repeat(129)],
    ['an object', { a: 1 }],
    ['an array', ['a']],
    ['NaN', Number.NaN],
    ['null', null]
  ])('Should drop a field holding %s', (_name, value) => {
    const { telemetry, logger } = setup()

    telemetry.info({ event: 'authorization.decision', reason: value }, 'm')

    expect(logger.info.mock.calls[0][0]).toEqual({
      event: 'authorization.decision'
    })
  })

  test('Should count events and record latency with only enumerated dimensions', () => {
    const { telemetry, metrics } = setup()

    telemetry.info(
      {
        event: 'auth.token-validation',
        outcome: 'failure',
        reason: 'expired',
        correlationId: 'trace-1',
        userId: 'u-1',
        durationMs: 5
      },
      'm'
    )

    expect(metrics.counter).toHaveBeenCalledWith('authTokenValidations', 1, {
      outcome: 'failure',
      reason: 'expired'
    })
    expect(metrics.millis).toHaveBeenCalledWith('authTokenValidationMs', 5, {
      outcome: 'failure',
      reason: 'expired'
    })
  })

  test.each([
    ['user-role-cache.hit', 'authUserRoleCacheEvents', 'hit'],
    [
      'user-role-cache.entry-evicted',
      'authUserRoleCacheEvents',
      'entry-evicted'
    ],
    [
      'role-definitions-cache.stale-used',
      'authRoleDefinitionsCacheEvents',
      'stale-used'
    ],
    [
      'role-definitions-cache.over-stale',
      'authRoleDefinitionsCacheEvents',
      'over-stale'
    ]
  ])(
    'Should count the cache event %s with a bounded result dimension',
    (event, counter, result) => {
      const { telemetry, metrics } = setup()

      telemetry.debug({ event, correlationId: 'trace-1' }, 'm')

      expect(metrics.counter).toHaveBeenCalledWith(counter, 1, { result })
    }
  )

  test.each([
    ['an unknown cache result', 'user-role-cache.some-user-abc'],
    ['an unknown event', 'something.else'],
    ['no event', undefined]
  ])('Should not create a metric for %s', (_name, event) => {
    const { telemetry, metrics, logger } = setup()

    telemetry.debug({ event }, 'm')

    expect(metrics.counter).not.toHaveBeenCalled()
    expect(logger.debug).toHaveBeenCalledTimes(1)
  })

  test('Should never create a series per user, correlation id, role, capability or token', () => {
    const { telemetry, metrics } = setup()

    for (let i = 0; i < 200; i++) {
      telemetry.debug(
        {
          event: 'authorization.decision',
          outcome: 'allowed',
          reason: 'granted',
          capability: `catch-record.read-${i}`,
          correlationId: `trace-${i}`,
          userId: `user-${i}`,
          durationMs: i
        },
        'm'
      )
    }

    const series = new Set(
      metrics.counter.mock.calls.map(([name, , dimensions]) =>
        JSON.stringify([name, dimensions])
      )
    )
    expect(series.size).toBe(1)
    expect([...series][0]).not.toMatch(/user-|trace-|catch-record/)
  })

  test('Should use stable metric names, one per event family', () => {
    const { telemetry, metrics } = setup()
    const events = [
      'auth.token-validation',
      'oidc.refresh',
      'oidc.lookup',
      'user-profile.request',
      'user-profile.retry',
      'authorization.decision',
      'authorization.missing-mapping',
      'access-response'
    ]

    events.forEach((event) => telemetry.info({ event }, 'm'))

    expect(metrics.counter.mock.calls.map(([name]) => name)).toEqual([
      'authTokenValidations',
      'authSigningKeyRefreshes',
      'authSigningKeyLookups',
      'authUserProfileRequests',
      'authUserProfileRetries',
      'authDecisions',
      'authMissingMappings',
      'authHttpOutcomes'
    ])
  })

  test('Should not let a failing log or metric sink throw or change behaviour', async () => {
    const logger = {
      warn: () => {
        throw new Error('log sink down')
      }
    }
    const metrics = {
      counter: () => {
        throw new Error('metrics down')
      },
      millis: () => Promise.reject(new Error('metrics rejected'))
    }
    const telemetry = createSecurityTelemetry({ logger, metrics })

    expect(() =>
      telemetry.warn({ event: 'authorization.decision', durationMs: 1 }, 'm')
    ).not.toThrow()
    await new Promise((resolve) => setImmediate(resolve))
  })

  test('Should reject a metrics promise without an unhandled rejection', async () => {
    const metrics = {
      counter: () => Promise.reject(new Error('rejected')),
      millis: () => Promise.reject(new Error('rejected'))
    }
    const telemetry = createSecurityTelemetry({ metrics })

    telemetry.info({ event: 'oidc.refresh', durationMs: 1 }, 'm')
    await new Promise((resolve) => setImmediate(resolve))
  })

  test('Should work without a logger or a metrics instance, and default the message to the event', () => {
    expect(() =>
      createSecurityTelemetry().debug({ event: 'oidc.refresh' }, 'm')
    ).not.toThrow()

    const { telemetry, logger } = setup()
    telemetry.error({ event: 'oidc.refresh' })
    expect(logger.error).toHaveBeenCalledWith(
      { event: 'oidc.refresh' },
      'oidc.refresh'
    )
  })
})

describe('#tokenFailureCategory', () => {
  test('Should map every token-validation failure to one bounded category', () => {
    const categories = new Set(
      Object.values(AccessTokenFailure).map(tokenFailureCategory)
    )

    expect([...categories].sort()).toEqual(
      [
        'algorithm',
        'audience',
        'expired',
        'identity-claim-or-unexpected',
        'issuer',
        'key',
        'key-source',
        'malformed',
        'missing',
        'not-yet-valid',
        'signature'
      ].sort()
    )
  })

  test('Should give an unknown reason the generic category', () => {
    expect(tokenFailureCategory('SOMETHING_NEW')).toBe(
      'identity-claim-or-unexpected'
    )
  })
})
