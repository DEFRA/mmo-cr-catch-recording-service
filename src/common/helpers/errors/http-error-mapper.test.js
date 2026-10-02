import Boom from '@hapi/boom'

import {
  APPLICATION_ERROR_CATEGORIES,
  CATEGORY_HTTP_STATUS
} from './error-categories.js'
import { ApplicationError } from './application-error.js'

const { getTraceId } = vi.hoisted(() => ({ getTraceId: vi.fn() }))

vi.mock('@defra/hapi-tracing', () => ({ getTraceId }))

const { mapErrorToHttpResponse } = await import('./http-error-mapper.js')

describe('#mapErrorToHttpResponse', () => {
  beforeEach(() => {
    getTraceId.mockReset()
  })

  describe('Application errors', () => {
    test.each(APPLICATION_ERROR_CATEGORIES)(
      'Should map category %s to its approved HTTP status',
      (category) => {
        const error = new ApplicationError(category, 'A safe message')

        const { statusCode, payload } = mapErrorToHttpResponse(error)

        expect(statusCode).toBe(CATEGORY_HTTP_STATUS[category])
        expect(payload.statusCode).toBe(CATEGORY_HTTP_STATUS[category])
      }
    )

    test('Should include the required payload fields', () => {
      const error = new ApplicationError(
        'RESOURCE_NOT_FOUND',
        'Catch record not found'
      )

      const { payload } = mapErrorToHttpResponse(error)

      expect(payload).toEqual({
        statusCode: 404,
        code: 'RESOURCE_NOT_FOUND',
        message: 'Catch record not found'
      })
    })

    test('Should include correlationId only when available', () => {
      getTraceId.mockReturnValue('trace-123')
      const error = new ApplicationError('RESOURCE_NOT_FOUND', 'Not found')

      const { payload } = mapErrorToHttpResponse(error)

      expect(payload.correlationId).toBe('trace-123')
    })

    test('Should omit correlationId when not available', () => {
      getTraceId.mockReturnValue(undefined)
      const error = new ApplicationError('RESOURCE_NOT_FOUND', 'Not found')

      const { payload } = mapErrorToHttpResponse(error)

      expect(payload).not.toHaveProperty('correlationId')
    })

    test('Should include only safe details when present', () => {
      const error = new ApplicationError('VERSION_CONFLICT', 'Stale version', {
        details: [
          { path: 'version', code: 'STALE_VERSION', submittedValue: 'unsafe' }
        ]
      })

      const { payload } = mapErrorToHttpResponse(error)

      expect(payload.details).toEqual([
        { path: 'version', code: 'STALE_VERSION' }
      ])
    })

    test('Should never expose cause, stack or meta in the payload', () => {
      const cause = new Error('internal cause with sensitive detail')
      const error = new ApplicationError(
        'UNEXPECTED_INTERNAL_FAILURE',
        'Safe message',
        {
          cause,
          meta: { internalFlag: 'should-not-leak' }
        }
      )

      const { payload } = mapErrorToHttpResponse(error)
      const serialised = JSON.stringify(payload)

      expect(serialised).not.toContain('sensitive detail')
      expect(serialised).not.toContain('should-not-leak')
      expect(payload).not.toHaveProperty('cause')
      expect(payload).not.toHaveProperty('stack')
      expect(payload).not.toHaveProperty('meta')
    })

    test('Should use an explicit code override over the category fallback', () => {
      const error = new ApplicationError('RESOURCE_NOT_FOUND', 'Not found', {
        code: 'CATCH_RECORD_NOT_FOUND'
      })

      const { payload } = mapErrorToHttpResponse(error)

      expect(payload.code).toBe('CATCH_RECORD_NOT_FOUND')
    })
  })

  describe('Joi/Hapi validation failures', () => {
    function createFakeJoiError() {
      const error = new Error(
        '"name" is required and "value" with "secret-value" fails pattern'
      )
      error.isJoi = true
      error.output = { statusCode: 400 }
      error.details = [
        {
          message: '"name" is required',
          path: ['name'],
          type: 'any.required',
          context: { label: 'name', value: 'secret-value' }
        }
      ]
      return error
    }

    test('Should map to a 400 with a generic safe message', () => {
      const { statusCode, payload } =
        mapErrorToHttpResponse(createFakeJoiError())

      expect(statusCode).toBe(400)
      expect(payload.code).toBe('INVALID_REQUEST')
      expect(payload.message).toBe('The request is invalid.')
    })

    test('Should include only path and code in details, never raw Joi internals or values', () => {
      const { payload } = mapErrorToHttpResponse(createFakeJoiError())

      expect(payload.details).toEqual([{ path: 'name', code: 'any.required' }])
      expect(JSON.stringify(payload)).not.toContain('secret-value')
    })

    test('Should default to status 400 when output.statusCode is unavailable', () => {
      const error = new Error('validation failed')
      error.isJoi = true
      error.details = [{ path: ['value'], type: 'any.required' }]

      const { statusCode } = mapErrorToHttpResponse(error)

      expect(statusCode).toBe(400)
    })

    test('Should stringify a non-array detail path', () => {
      const error = new Error('validation failed')
      error.isJoi = true
      error.output = { statusCode: 400 }
      error.details = [{ path: 'topLevel', type: 'any.required' }]

      const { payload } = mapErrorToHttpResponse(error)

      expect(payload.details).toEqual([
        { path: 'topLevel', code: 'any.required' }
      ])
    })

    test('Should default to an empty path when the detail has no path at all', () => {
      const error = new Error('validation failed')
      error.isJoi = true
      error.output = { statusCode: 400 }
      error.details = [{ type: 'any.required' }]

      const { payload } = mapErrorToHttpResponse(error)

      expect(payload.details).toEqual([{ path: '', code: 'any.required' }])
    })

    test('Should derive an HTTP_<status> fallback code for a validation status outside the known table', () => {
      const error = new Error('validation failed')
      error.isJoi = true
      error.output = { statusCode: 418 }
      error.details = [{ path: ['value'], type: 'any.required' }]

      const { payload } = mapErrorToHttpResponse(error)

      expect(payload.code).toBe('HTTP_418')
    })
  })

  describe('Existing Boom errors', () => {
    test('Should preserve the existing status and safe message for a 4xx Boom error', () => {
      const error = Boom.notFound('Catch record not found')

      const { statusCode, payload } = mapErrorToHttpResponse(error)

      expect(statusCode).toBe(404)
      expect(payload.message).toBe('Catch record not found')
      expect(payload.code).toBe('RESOURCE_NOT_FOUND')
    })

    test('Should preserve an ambiguous 409 status with a generic fallback code', () => {
      const error = Boom.conflict('Something conflicted')

      const { payload } = mapErrorToHttpResponse(error)

      expect(payload.code).toBe('CONFLICT')
    })

    test('Should derive an HTTP_<status> fallback code for a status outside the known table', () => {
      const error = Boom.methodNotAllowed('Method not allowed')

      const { statusCode, payload } = mapErrorToHttpResponse(error)

      expect(statusCode).toBe(405)
      expect(payload.code).toBe('HTTP_405')
    })

    test('Should use an existing application code from Boom error data when present', () => {
      const error = Boom.conflict('Something conflicted', {
        code: 'CUSTOM_CONFLICT'
      })

      const { payload } = mapErrorToHttpResponse(error)

      expect(payload.code).toBe('CUSTOM_CONFLICT')
    })

    test('Should never leak the original message for a 500-level Boom error', () => {
      const error = Boom.badImplementation('leaked internal detail')

      const { statusCode, payload } = mapErrorToHttpResponse(error)

      expect(statusCode).toBe(500)
      expect(payload.message).not.toContain('leaked internal detail')
      expect(payload.code).toBe('INTERNAL_SERVER_ERROR')
    })

    test('Should not double-wrap an existing Boom error', () => {
      const error = Boom.unauthorized('Needs auth')

      const { statusCode } = mapErrorToHttpResponse(error)

      expect(statusCode).toBe(401)
      expect(Boom.isBoom(error)).toBe(true)
    })
  })

  describe('Unexpected failures', () => {
    test('Should map an auto-boomified plain Error to a safe 500 without leaking its message', () => {
      const error = Boom.boomify(new Error('db connection string exposed'))

      const { statusCode, payload } = mapErrorToHttpResponse(error)

      expect(statusCode).toBe(500)
      expect(payload.code).toBe('INTERNAL_SERVER_ERROR')
      expect(payload.message).not.toContain('db connection string exposed')
    })

    test('Should map a null/undefined input to a safe 500', () => {
      expect(mapErrorToHttpResponse(null).statusCode).toBe(500)
      expect(mapErrorToHttpResponse(undefined).statusCode).toBe(500)
    })

    test('Should still return a safe 500 if correlation retrieval itself throws', () => {
      getTraceId.mockImplementation(() => {
        throw new Error('tracing context unavailable')
      })

      const { statusCode, payload } = mapErrorToHttpResponse(
        new ApplicationError('RESOURCE_NOT_FOUND', 'Not found')
      )

      expect(statusCode).toBe(500)
      expect(payload.code).toBe('INTERNAL_SERVER_ERROR')
    })

    test('Should not throw for a missing correlation id', () => {
      getTraceId.mockReturnValue(undefined)

      expect(() => mapErrorToHttpResponse(Boom.notFound())).not.toThrow()
    })
  })
})
