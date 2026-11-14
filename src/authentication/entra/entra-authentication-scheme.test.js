import Hapi from '@hapi/hapi'

import { createSecurityTelemetry } from '#/authorization/security-telemetry.js'
import { errorMapping } from '#/plugins/error-mapping.js'
import { requestTracing } from '#/plugins/request-tracing.js'
import { ENTRA_AUTH_STRATEGY } from './entra-auth-strategy.js'
import { entraAuthenticationScheme } from './entra-authentication-scheme.js'

async function createServer({ validate, userIdClaim = 'oid', telemetry }) {
  const server = Hapi.server()
  await server.register([requestTracing, errorMapping])
  server.auth.scheme(ENTRA_AUTH_STRATEGY, entraAuthenticationScheme)
  server.auth.strategy(ENTRA_AUTH_STRATEGY, ENTRA_AUTH_STRATEGY, {
    validator: { validate },
    userIdClaim,
    telemetry
  })
  server.route({
    method: 'GET',
    path: '/p',
    options: { auth: ENTRA_AUTH_STRATEGY },
    handler: () => 'ok'
  })
  return server
}

const get = (server) =>
  server.inject({
    url: '/p',
    headers: {
      authorization: 'Bearer secret-token-value',
      'x-cdp-request-id': 'trace-77'
    }
  })

describe('#entraAuthenticationScheme telemetry', () => {
  const setup = () => {
    const logs = { debug: vi.fn(), info: vi.fn(), warn: vi.fn() }
    const metrics = {
      counter: vi.fn(async () => {}),
      millis: vi.fn(async () => {})
    }
    return {
      logs,
      metrics,
      telemetry: createSecurityTelemetry({ logger: logs, metrics })
    }
  }

  test('Should report a success at debug level with latency and correlation, and no identity', async () => {
    const { telemetry, logs, metrics } = setup()
    const server = await createServer({
      telemetry,
      validate: async () => ({
        ok: true,
        claims: Object.freeze({ oid: 'user-abc' })
      })
    })

    expect((await get(server)).statusCode).toBe(200)

    expect(logs.debug).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'auth.token-validation',
        outcome: 'success',
        reason: 'authenticated',
        correlationId: 'trace-77',
        durationMs: expect.any(Number)
      }),
      expect.any(String)
    )
    expect(metrics.counter).toHaveBeenCalledWith('authTokenValidations', 1, {
      outcome: 'success',
      reason: 'authenticated'
    })
    expect(JSON.stringify(logs.debug.mock.calls)).not.toMatch(
      /user-abc|secret-token/
    )
  })

  test.each([
    ['an expired token', 'EXPIRED_TOKEN', 'credentials', 'info', 'expired'],
    [
      'an invalid signature',
      'INVALID_SIGNATURE',
      'credentials',
      'info',
      'signature'
    ],
    [
      'an unavailable signing-key source',
      'SIGNING_KEY_UNAVAILABLE',
      'dependency',
      'warn',
      'key-source'
    ],
    [
      'an unexpected validation failure',
      'UNEXPECTED_VALIDATION_FAILURE',
      'internal',
      'warn',
      'identity-claim-or-unexpected'
    ]
  ])(
    'Should report %s with the right severity and a bounded category',
    async (_name, reason, source, level, category) => {
      const { telemetry, logs, metrics } = setup()
      const server = await createServer({
        telemetry,
        validate: async () => ({ ok: false, reason, source })
      })

      expect((await get(server)).statusCode).toBe(401)

      expect(logs[level]).toHaveBeenCalledWith(
        expect.objectContaining({ outcome: 'failure', reason: category }),
        expect.any(String)
      )
      expect(logs.warn.mock.calls.length > 0).toBe(level === 'warn')
      expect(metrics.counter).toHaveBeenCalledWith('authTokenValidations', 1, {
        outcome: 'failure',
        reason: category
      })
      expect(
        JSON.stringify([...logs.info.mock.calls, ...logs.warn.mock.calls])
      ).not.toMatch(/secret-token|EXPIRED_TOKEN|INVALID_SIGNATURE/)
    }
  )

  test('Should report an unusable identity claim as an identity-claim failure', async () => {
    const { telemetry, logs } = setup()
    const server = await createServer({
      telemetry,
      validate: async () => ({ ok: true, claims: Object.freeze({ oid: 42 }) })
    })

    expect((await get(server)).statusCode).toBe(401)

    expect(logs.info).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'failure', reason: 'identity-claim' }),
      expect.any(String)
    )
  })

  test('Should keep authenticating when telemetry itself fails', async () => {
    const server = await createServer({
      telemetry: {
        debug: () => {
          throw new Error('down')
        },
        info: () => {
          throw new Error('down')
        },
        warn: () => {
          throw new Error('down')
        }
      },
      validate: async () => ({
        ok: true,
        claims: Object.freeze({ oid: 'user-abc' })
      })
    })

    expect((await get(server)).statusCode).toBe(200)
  })

  test('Should authenticate and reject without any telemetry configured', async () => {
    const ok = await createServer({
      validate: async () => ({ ok: true, claims: Object.freeze({ oid: 'u' }) })
    })
    const bad = await createServer({
      validate: async () => ({
        ok: false,
        reason: 'EXPIRED_TOKEN',
        source: 'credentials'
      })
    })

    expect((await get(ok)).statusCode).toBe(200)
    expect((await get(bad)).statusCode).toBe(401)
  })
})
