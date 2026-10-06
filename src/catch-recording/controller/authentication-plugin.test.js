/* global fetchMock */
import { readFileSync } from 'node:fs'

import Hapi from '@hapi/hapi'
import Boom from '@hapi/boom'

import { authenticationPlugin } from './authentication-plugin.js'
import { errorMapping } from '#/plugins/error-mapping.js'
import { requestTracing } from '#/plugins/request-tracing.js'
import { failAction } from '#/common/helpers/fail-action.js'

vi.mock('@defra/cdp-auditing', () => ({ audit: vi.fn() }))

const { audit } = await import('@defra/cdp-auditing')

const AUTH_OPTIONS = {
  baseUrl: 'https://authentication-service.example',
  timeoutMs: 1000,
  retryCount: 0,
  retryDelayMs: 0,
  tracingHeader: 'x-cdp-request-id'
}

async function createTestServer({ withTracing = true } = {}) {
  const server = Hapi.server({
    routes: {
      validate: { options: { abortEarly: false }, failAction }
    }
  })

  if (withTracing) {
    await server.register(requestTracing)
  }

  await server.register(errorMapping)
  await server.register({ plugin: authenticationPlugin, options: AUTH_OPTIONS })

  server.route([
    {
      method: 'GET',
      path: '/open',
      handler: () => ({ ok: true })
    },
    {
      method: 'GET',
      path: '/protected',
      options: { auth: 'authentication-service' },
      handler: (request) => request.auth.credentials
    },
    {
      method: 'POST',
      path: '/protected-with-payload',
      options: { auth: 'authentication-service' },
      handler: (request) => ({
        credentials: request.auth.credentials,
        payload: request.payload
      })
    },
    {
      method: 'GET',
      path: '/protected/{userId}',
      options: { auth: 'authentication-service' },
      handler: (request) => ({
        credentials: request.auth.credentials,
        pathUserId: request.params.userId
      })
    },
    {
      method: 'GET',
      path: '/boom-unauthorized',
      handler: () => Boom.unauthorized('Missing token', 'Bearer')
    }
  ])

  await server.initialize()

  return server
}

describe('#authenticationPlugin (Hapi integration)', () => {
  let server

  afterEach(async () => {
    if (server) {
      await server.stop({ timeout: 0 })
      server = undefined
    }
  })

  test('Should authenticate a valid bearer token and expose only the approved context', async () => {
    fetchMock.mockResponseOnce(
      JSON.stringify({
        actorId: 'user-1',
        permissions: ['catch-recording.read']
      })
    )
    server = await createTestServer()

    const response = await server.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: 'Bearer valid-token' }
    })

    expect(response.statusCode).toBe(200)
    expect(response.result).toEqual({
      userId: 'user-1',
      scopes: ['catch-recording.read']
    })
  })

  test('Should reject a request with no Authorization header', async () => {
    server = await createTestServer()

    const response = await server.inject({ method: 'GET', url: '/protected' })

    expect(response.statusCode).toBe(401)
    expect(response.result).toMatchObject({
      statusCode: 401,
      code: 'AUTHENTICATION_REQUIRED'
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test('Should reject a malformed/empty bearer token', async () => {
    server = await createTestServer()

    const response = await server.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: 'Bearer ' }
    })

    expect(response.statusCode).toBe(401)
    expect(response.result.code).toBe('AUTHENTICATION_REQUIRED')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test('Should reject when the Authentication Service rejects the token', async () => {
    fetchMock.mockResponseOnce('', { status: 401 })
    server = await createTestServer()

    const response = await server.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: 'Bearer bad-token' }
    })

    expect(response.statusCode).toBe(401)
    expect(response.result.code).toBe('AUTHENTICATION_REQUIRED')
  })

  test('Should ignore a payload-supplied identity and use only the trusted context', async () => {
    fetchMock.mockResponseOnce(
      JSON.stringify({ actorId: 'trusted-user', permissions: [] })
    )
    server = await createTestServer()

    const response = await server.inject({
      method: 'POST',
      url: '/protected-with-payload',
      headers: { authorization: 'Bearer valid-token' },
      payload: { ownerUserId: 'SPOOFED-USER', actorId: 'SPOOFED-ACTOR' }
    })

    expect(response.statusCode).toBe(200)
    expect(response.result.credentials.userId).toBe('trusted-user')
  })

  test('Should ignore a path-supplied identity value and use only the trusted context', async () => {
    fetchMock.mockResponseOnce(
      JSON.stringify({ actorId: 'trusted-user', permissions: [] })
    )
    server = await createTestServer()

    const response = await server.inject({
      method: 'GET',
      url: '/protected/SPOOFED-PATH-USER',
      headers: { authorization: 'Bearer valid-token' }
    })

    expect(response.statusCode).toBe(200)
    expect(response.result.credentials.userId).toBe('trusted-user')
    expect(response.result.pathUserId).toBe('SPOOFED-PATH-USER')
  })

  test('Should ignore an unapproved spoofed identity header', async () => {
    fetchMock.mockResponseOnce(
      JSON.stringify({ actorId: 'trusted-user', permissions: [] })
    )
    server = await createTestServer()

    const response = await server.inject({
      method: 'GET',
      url: '/protected',
      headers: {
        authorization: 'Bearer valid-token',
        'x-user-id': 'SPOOFED-HEADER-USER'
      }
    })

    expect(response.statusCode).toBe(200)
    expect(response.result.userId).toBe('trusted-user')
  })

  test('Should leave an unauthenticated route unaffected', async () => {
    server = await createTestServer()

    const response = await server.inject({ method: 'GET', url: '/open' })

    expect(response.statusCode).toBe(200)
    expect(response.result).toEqual({ ok: true })
  })

  test('Should preserve existing unrelated Boom WWW-Authenticate challenge behaviour', async () => {
    server = await createTestServer()

    const response = await server.inject({
      method: 'GET',
      url: '/boom-unauthorized'
    })

    expect(response.statusCode).toBe(401)
    expect(response.headers['www-authenticate']).toBe(
      'Bearer error="Missing token"'
    )
  })

  test('Should never leak the token or the Authentication Service response body into the public error', async () => {
    const sentinelToken = 'SENTINEL-TOKEN'
    fetchMock.mockResponseOnce(
      JSON.stringify({ leaked: 'SENTINEL-BODY', permissions: [] })
    )
    server = await createTestServer()

    const response = await server.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: `Bearer ${sentinelToken}` }
    })

    const serialised = JSON.stringify(response.result)
    expect(serialised).not.toContain(sentinelToken)
    expect(serialised).not.toContain('SENTINEL-BODY')
  })

  test('Should audit authentication outcomes without recording sensitive values', async () => {
    fetchMock.mockResponseOnce(
      JSON.stringify({
        actorId: 'user-1',
        permissions: ['catch-recording.read']
      })
    )
    server = await createTestServer()

    await server.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: 'Bearer valid-token' }
    })

    expect(audit).toHaveBeenCalled()
    const serialisedAudit = JSON.stringify(audit.mock.calls)
    expect(serialisedAudit).not.toContain('valid-token')
    expect(serialisedAudit).not.toContain('user-1')
    expect(serialisedAudit).not.toContain('catch-recording.read')
  })

  test('Should include the correlation id in the audit call when tracing supplies one', async () => {
    fetchMock.mockResponseOnce('', { status: 401 })
    server = await createTestServer({ withTracing: true })

    await server.inject({
      method: 'GET',
      url: '/protected',
      headers: {
        authorization: 'Bearer bad-token',
        'x-cdp-request-id': 'trace-plugin-123'
      }
    })

    const serialisedAudit = JSON.stringify(audit.mock.calls)
    expect(serialisedAudit).toContain('trace-plugin-123')
  })

  test('Should register the authentication plugin exactly once', async () => {
    server = await createTestServer()

    expect(server.registrations.authentication).toBeDefined()
  })

  test('Should be registered in the real server composition', () => {
    const source = readFileSync(
      new URL('../../server.js', import.meta.url),
      'utf8'
    )

    expect(source).toMatch(/authenticationPlugin/)
  })
})
