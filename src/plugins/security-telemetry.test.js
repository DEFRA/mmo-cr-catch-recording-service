import Hapi from '@hapi/hapi'

import { registerStubAuthorization } from '#/authorization/authorization-test-fixtures.js'
import { errorMapping } from './error-mapping.js'
import { securityTelemetry } from './security-telemetry.js'

const createServer = async () => {
  const server = Hapi.server()
  const logs = { debug: vi.fn(), info: vi.fn(), warn: vi.fn() }
  const metrics = {
    counter: vi.fn(async () => {}),
    millis: vi.fn(async () => {})
  }
  server.decorate('server', 'logger', logs)
  server.decorate('server', 'metrics', metrics)
  await server.register(securityTelemetry)
  return { server, logs, metrics }
}

describe('#securityTelemetry', () => {
  test('Should decorate the server with a sink backed by the server logger and metrics', async () => {
    const { server, logs, metrics } = await createServer()

    server.securityTelemetry.info(
      { event: 'oidc.refresh', outcome: 'success', durationMs: 3 },
      'm'
    )

    expect(logs.info).toHaveBeenCalledWith(
      { event: 'oidc.refresh', outcome: 'success', durationMs: 3 },
      'm'
    )
    expect(metrics.counter).toHaveBeenCalledWith('authSigningKeyRefreshes', 1, {
      outcome: 'success'
    })
  })

  test('Should report an unmapped protected route as a missing-mapping warning without route or user detail', async () => {
    const { server, logs, metrics } = await createServer()
    await server.register(errorMapping)
    await registerStubAuthorization(server)
    server.route({
      method: 'GET',
      path: '/secret-route/{userSegment}',
      options: { auth: 'entra-bearer' },
      handler: () => 'ok'
    })

    const response = await server.inject({
      url: '/secret-route/user-1',
      headers: { authorization: 'Bearer token-1' }
    })

    expect(response.statusCode).toBe(500)
    expect(logs.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'authorization.missing-mapping',
        reason: 'missing-capability-mapping'
      }),
      expect.any(String)
    )
    expect(metrics.counter).toHaveBeenCalledWith('authMissingMappings', 1, {})
    expect(JSON.stringify(logs.warn.mock.calls)).not.toMatch(
      /secret-route|user-1/
    )
  })

  test('Should use a request logger fallback when no telemetry is registered', async () => {
    const server = Hapi.server()
    await server.register(errorMapping)
    await registerStubAuthorization(server)
    const info = vi.fn()
    server.ext('onRequest', (request, h) => {
      request.logger = { info }
      return h.continue
    })
    server.route({
      method: 'GET',
      path: '/x',
      options: { auth: 'entra-bearer' },
      handler: () => 'ok'
    })

    await server.inject({
      url: '/x',
      headers: { authorization: 'Bearer nope' }
    })

    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'access-response', statusCode: 401 }),
      expect.any(String)
    )
  })
})
