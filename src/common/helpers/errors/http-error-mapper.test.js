import { readFileSync } from 'node:fs'

import { ApplicationError } from './application-error.js'
import { mapErrorToResponse } from './http-error-mapper.js'

function boom(statusCode, message, { headers, data, payloadValidation } = {}) {
  return {
    isBoom: true,
    data,
    output: {
      statusCode,
      payload: {
        statusCode,
        error: 'Error',
        message,
        ...(payloadValidation ? { validation: payloadValidation } : {})
      },
      headers: headers ?? {}
    }
  }
}

describe('#mapErrorToResponse', () => {
  describe('ApplicationError mapping', () => {
    test.each([
      ['INVALID_REQUEST', 400],
      ['AUTHENTICATION_FAILURE', 401],
      ['AUTHORISATION_FAILURE', 403],
      ['RESOURCE_NOT_FOUND', 404],
      ['VERSION_CONFLICT', 409],
      ['INVALID_LIFECYCLE_TRANSITION', 409],
      ['DUPLICATE_RESOURCE', 409],
      ['IDEMPOTENCY_CONFLICT', 409],
      ['BUSINESS_VALIDATION_FAILURE', 422],
      ['UPSTREAM_INVALID_RESPONSE', 502],
      ['DEPENDENCY_UNAVAILABLE', 503],
      ['UPSTREAM_TIMEOUT', 504],
      ['ARTIFACT_OPERATION_FAILURE', 500],
      ['UNEXPECTED_INTERNAL_FAILURE', 500]
    ])(
      'Should map %s to HTTP %i using the fallback code',
      (category, status) => {
        const error = new ApplicationError({
          category,
          message: 'Safe message'
        })
        const result = mapErrorToResponse(error, undefined)

        expect(result.statusCode).toBe(status)
        expect(result.payload.statusCode).toBe(status)
        expect(result.payload.code).toBe(error.code)
        expect(result.payload.message).toBe('Safe message')
        expect(result.payload.correlationId).toBeUndefined()
        expect(result.payload.details).toBeUndefined()
      }
    )

    test('Should preserve a specific stable code over the fallback code', () => {
      const error = new ApplicationError({
        category: 'RESOURCE_NOT_FOUND',
        code: 'CATCH_RECORD_NOT_FOUND',
        message: 'Catch record not found'
      })

      const result = mapErrorToResponse(error, undefined)

      expect(result.payload.code).toBe('CATCH_RECORD_NOT_FOUND')
    })

    test('Should include sanitised details when present', () => {
      const error = new ApplicationError({
        category: 'BUSINESS_VALIDATION_FAILURE',
        message: 'Invalid catch record',
        details: [
          { path: 'version', code: 'STALE_VERSION', value: 'should be dropped' }
        ]
      })

      const result = mapErrorToResponse(error, undefined)

      expect(result.payload.details).toEqual([
        { path: 'version', code: 'STALE_VERSION' }
      ])
    })

    test('Should include the correlation id only when supplied', () => {
      const error = new ApplicationError({
        category: 'INVALID_REQUEST',
        message: 'Invalid'
      })

      expect(mapErrorToResponse(error, 'trace-123').payload.correlationId).toBe(
        'trace-123'
      )
      expect(
        mapErrorToResponse(error, undefined).payload.correlationId
      ).toBeUndefined()
    })

    test('Should fail safely when an ApplicationError is mutated into a malformed state', () => {
      const error = new ApplicationError({
        category: 'INVALID_REQUEST',
        message: 'Invalid'
      })
      error.category = 'NOT_A_REAL_CATEGORY'

      const result = mapErrorToResponse(error, undefined)

      expect(result.statusCode).toBe(500)
      expect(result.payload.code).toBe('INTERNAL_SERVER_ERROR')
      expect(result.payload.message).toBe('An unexpected error occurred.')
    })
  })

  describe('Joi/Hapi validation mapping', () => {
    test('Should return the safe approved validation response', () => {
      const error = boom(400, 'Invalid request payload input', {
        payloadValidation: { source: 'payload', keys: ['name'] }
      })
      error.details = [
        {
          message: '"name" is required',
          path: ['name'],
          type: 'any.required',
          context: { label: 'name' }
        }
      ]

      const result = mapErrorToResponse(error, 'trace-456')

      expect(result.statusCode).toBe(400)
      expect(result.payload).toEqual({
        statusCode: 400,
        code: 'INVALID_REQUEST',
        message: 'The request is invalid.',
        correlationId: 'trace-456',
        details: [{ path: 'name', code: 'any.required' }]
      })
    })

    test('Should omit details when none are present', () => {
      const error = boom(400, 'Invalid', {
        payloadValidation: { source: 'payload', keys: [] }
      })

      const result = mapErrorToResponse(error, undefined)

      expect(result.payload.details).toBeUndefined()
    })
  })

  describe('Existing Boom error mapping', () => {
    test('Should preserve status, safe message, and headers for a 401 with a challenge header', () => {
      const error = boom(401, 'Missing authentication', {
        headers: { 'WWW-Authenticate': 'Bearer' }
      })

      const result = mapErrorToResponse(error, undefined)

      expect(result.statusCode).toBe(401)
      expect(result.payload.message).toBe('Missing authentication')
      expect(result.payload.code).toBe('AUTHENTICATION_REQUIRED')
      expect(result.headers).toEqual({ 'WWW-Authenticate': 'Bearer' })
    })

    test('Should use the generic CONFLICT code for an unclassified 409', () => {
      const error = boom(409, 'Conflict')

      const result = mapErrorToResponse(error, undefined)

      expect(result.payload.code).toBe('CONFLICT')
    })

    test('Should use a deterministic fallback for a status outside the explicit table', () => {
      const error = boom(418, "I'm a teapot")

      const result = mapErrorToResponse(error, undefined)

      expect(result.payload.code).toBe('HTTP_418')
    })

    test('Should use an explicitly supplied stable code when present via the Boom data convention', () => {
      const error = boom(404, 'Not found', {
        data: { code: 'CATCH_RECORD_NOT_FOUND' }
      })

      const result = mapErrorToResponse(error, undefined)

      expect(result.payload.code).toBe('CATCH_RECORD_NOT_FOUND')
    })

    test('Should never expose Boom internal metadata', () => {
      const error = boom(404, 'Not found')

      const result = mapErrorToResponse(error, undefined)

      expect(result.payload).not.toHaveProperty('isBoom')
      expect(result.payload).not.toHaveProperty('output')
      expect(result.payload).not.toHaveProperty('data')
    })
  })

  describe('Unexpected and malformed errors', () => {
    test('Should return the safe generic 500 for an unexpected Error', () => {
      const result = mapErrorToResponse(
        new Error('database connection string leaked'),
        undefined
      )

      expect(result.statusCode).toBe(500)
      expect(result.payload.code).toBe('INTERNAL_SERVER_ERROR')
      expect(result.payload.message).toBe('An unexpected error occurred.')
      expect(JSON.stringify(result.payload)).not.toContain(
        'database connection string'
      )
    })

    test('Should handle a non-Error thrown value safely', () => {
      expect(
        mapErrorToResponse('plain string failure', undefined).statusCode
      ).toBe(500)
      expect(mapErrorToResponse(42, undefined).statusCode).toBe(500)
      expect(mapErrorToResponse(null, undefined).statusCode).toBe(500)
      expect(mapErrorToResponse(undefined, undefined).statusCode).toBe(500)
    })

    test('Should include the correlation id for an unexpected error when available', () => {
      const result = mapErrorToResponse(new Error('boom'), 'trace-789')

      expect(result.payload.correlationId).toBe('trace-789')
    })
  })

  describe('Mapper failure fallback', () => {
    test('Should fall back to the safe generic 500 if mapping itself throws', () => {
      const poisoned = {
        isBoom: true,
        get output() {
          throw new Error('poisoned getter')
        }
      }

      const result = mapErrorToResponse(poisoned, undefined)

      expect(result.statusCode).toBe(500)
      expect(result.payload.code).toBe('INTERNAL_SERVER_ERROR')
      expect(result.payload.message).toBe('An unexpected error occurred.')
    })
  })

  test('Should not import Hapi or Boom', () => {
    const source = readFileSync(
      new URL('./http-error-mapper.js', import.meta.url),
      'utf8'
    )

    expect(source).not.toMatch(/from\s+['"]@hapi\/hapi['"]/)
    expect(source).not.toMatch(/from\s+['"]@hapi\/boom['"]/)
  })
})
