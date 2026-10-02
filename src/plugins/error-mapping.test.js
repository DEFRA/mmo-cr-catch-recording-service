import Joi from 'joi'

import { ApplicationError } from '#/common/helpers/errors/application-error.js'

import { errorMapping } from './error-mapping.js'

describe('#errorMapping (plugin registration)', () => {
  test('Should register a single onPreResponse extension', () => {
    const fakeServer = { ext: vi.fn() }

    errorMapping.plugin.register(fakeServer)

    expect(fakeServer.ext).toHaveBeenCalledTimes(1)
    expect(fakeServer.ext).toHaveBeenCalledWith(
      'onPreResponse',
      expect.any(Function)
    )
  })

  test('Should continue unchanged for a non-error response', () => {
    const fakeServer = { ext: vi.fn() }
    errorMapping.plugin.register(fakeServer)
    const onPreResponse = fakeServer.ext.mock.calls[0][1]

    const request = { response: { isBoom: false } }
    const h = { continue: Symbol('continue') }

    const result = onPreResponse(request, h)

    expect(result).toBe(h.continue)
  })
})

describe('#errorMapping (server integration)', () => {
  let server

  beforeAll(async () => {
    // Dynamic import needed due to config being updated by vitest-mongodb (same pattern as
    // src/plugins/mongodb.test.js)
    const { createServer } = await import('#/server.js')

    server = await createServer()

    // Test-only routes, registered directly on the test server instance only — never added to
    // src/plugins/router.js or production registration.
    server.route([
      {
        method: 'POST',
        path: '/__test/validate',
        options: {
          validate: {
            payload: Joi.object({
              name: Joi.string().required()
            })
          }
        },
        handler: (request, h) => h.response({ name: request.payload.name })
      },
      {
        method: 'GET',
        path: '/__test/application-error',
        handler: () => {
          throw new ApplicationError(
            'RESOURCE_NOT_FOUND',
            'Catch record not found',
            {
              code: 'CATCH_RECORD_NOT_FOUND'
            }
          )
        }
      },
      {
        method: 'GET',
        path: '/__test/unexpected-error',
        handler: () => {
          throw new Error('unexpected internal failure with sensitive detail')
        }
      }
    ])

    await server.initialize()
  })

  afterAll(async () => {
    await server.stop({ timeout: 1000 })
  })

  test('Should leave the existing /health response unchanged', async () => {
    const { statusCode, result } = await server.inject({
      method: 'GET',
      url: '/health'
    })

    expect(statusCode).toBe(200)
    expect(result).toEqual({ message: 'success' })
  })

  test('Should leave the existing /example list response unchanged', async () => {
    const { statusCode, result } = await server.inject({
      method: 'GET',
      url: '/example'
    })

    expect(statusCode).toBe(200)
    expect(Array.isArray(result)).toBe(true)
  })

  test('Should preserve the existing /example/{id} 404 status and add safe fields', async () => {
    const { statusCode, result } = await server.inject({
      method: 'GET',
      url: '/example/does-not-exist'
    })

    expect(statusCode).toBe(404)
    expect(result.statusCode).toBe(404)
    expect(result.code).toBe('RESOURCE_NOT_FOUND')
    expect(result).not.toHaveProperty('error')
  })

  test('Should map a controlled application error to its approved status and code', async () => {
    const { statusCode, result } = await server.inject({
      method: 'GET',
      url: '/__test/application-error'
    })

    expect(statusCode).toBe(404)
    expect(result).toMatchObject({
      statusCode: 404,
      code: 'CATCH_RECORD_NOT_FOUND',
      message: 'Catch record not found'
    })
  })

  test('Should map a route-validation failure to a safe 400 response', async () => {
    const { statusCode, result } = await server.inject({
      method: 'POST',
      url: '/__test/validate',
      payload: {}
    })

    expect(statusCode).toBe(400)
    expect(result.code).toBe('INVALID_REQUEST')
    expect(result.message).toBe('The request is invalid.')
    expect(JSON.stringify(result)).not.toContain('is required')
  })

  test('Should map an unexpected handler failure to a safe 500 response', async () => {
    const { statusCode, result } = await server.inject({
      method: 'GET',
      url: '/__test/unexpected-error'
    })

    expect(statusCode).toBe(500)
    expect(result.code).toBe('INTERNAL_SERVER_ERROR')
    expect(JSON.stringify(result)).not.toContain('sensitive detail')
  })

  test('Should include the correlation id when the tracing header is sent', async () => {
    const { result } = await server.inject({
      method: 'GET',
      url: '/__test/application-error',
      headers: { 'x-cdp-request-id': 'test-correlation-id' }
    })

    expect(result.correlationId).toBe('test-correlation-id')
  })
})
