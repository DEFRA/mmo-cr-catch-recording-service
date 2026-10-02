import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { APPLICATION_ERROR_CATEGORIES } from './error-categories.js'
import { ApplicationError, isApplicationError } from './application-error.js'

describe('#ApplicationError', () => {
  test.each(APPLICATION_ERROR_CATEGORIES)(
    'Should construct successfully for approved category %s',
    (category) => {
      const error = new ApplicationError(category, 'A safe message')

      expect(error).toBeInstanceOf(Error)
      expect(error.category).toBe(category)
      expect(typeof error.code).toBe('string')
      expect(error.message).toBe('A safe message')
    }
  )

  test('Should throw deterministically for an unsupported category', () => {
    expect(
      () => new ApplicationError('NOT_APPROVED', 'A safe message')
    ).toThrow('Unsupported application error category: "NOT_APPROVED"')
  })

  test('Should throw deterministically when the message is missing', () => {
    expect(() => new ApplicationError('RESOURCE_NOT_FOUND')).toThrow(
      'ApplicationError requires a safe public message'
    )
  })

  test('Should use the category fallback code when no explicit code is supplied', () => {
    const error = new ApplicationError('RESOURCE_NOT_FOUND', 'Not found')

    expect(error.code).toBe('RESOURCE_NOT_FOUND')
  })

  test('Should respect an explicit code override', () => {
    const error = new ApplicationError('RESOURCE_NOT_FOUND', 'Not found', {
      code: 'CATCH_RECORD_NOT_FOUND'
    })

    expect(error.code).toBe('CATCH_RECORD_NOT_FOUND')
  })

  test('Should preserve the original cause internally', () => {
    const cause = new Error('original failure')
    const error = new ApplicationError(
      'UNEXPECTED_INTERNAL_FAILURE',
      'Safe message',
      {
        cause
      }
    )

    expect(error.cause).toBe(cause)
  })

  test('Should not expose cause via JSON serialisation', () => {
    const cause = new Error('original failure with sensitive detail')
    const error = new ApplicationError(
      'UNEXPECTED_INTERNAL_FAILURE',
      'Safe message',
      {
        cause
      }
    )

    expect(JSON.stringify(error)).not.toContain('sensitive detail')
  })

  test('Should freeze meta and never expose it via JSON serialisation', () => {
    const error = new ApplicationError(
      'UNEXPECTED_INTERNAL_FAILURE',
      'Safe message',
      {
        meta: { internalFlag: 'secret-internal-value' }
      }
    )

    expect(Object.isFrozen(error.meta)).toBe(true)
    expect(JSON.stringify(error)).not.toContain('secret-internal-value')
  })

  test('Should not mutate caller-supplied details', () => {
    const details = [{ path: 'version', code: 'STALE_VERSION' }]
    const snapshot = JSON.parse(JSON.stringify(details))

    // eslint-disable-next-line no-new
    new ApplicationError('VERSION_CONFLICT', 'Safe message', { details })

    expect(details).toEqual(snapshot)
  })

  test('Should strip unsafe detail fields via the shared safe-details allow-list', () => {
    const error = new ApplicationError('VERSION_CONFLICT', 'Safe message', {
      details: [
        { path: 'version', code: 'STALE_VERSION', submittedValue: 'unsafe' }
      ]
    })

    expect(error.details).toEqual([{ path: 'version', code: 'STALE_VERSION' }])
  })

  test('isApplicationError should recognise an ApplicationError instance', () => {
    const error = new ApplicationError('RESOURCE_NOT_FOUND', 'Not found')

    expect(isApplicationError(error)).toBe(true)
  })

  test('isApplicationError should reject a plain Error and non-error values', () => {
    expect(isApplicationError(new Error('plain'))).toBe(false)
    expect(isApplicationError(undefined)).toBe(false)
    expect(isApplicationError({ category: 'RESOURCE_NOT_FOUND' })).toBe(false)
  })
})

describe('Application-error contract source files', () => {
  const directory = dirname(fileURLToPath(import.meta.url))
  const frameworkAgnosticFiles = [
    'application-error.js',
    'error-categories.js',
    'safe-details.js'
  ]

  test.each(frameworkAgnosticFiles)(
    'Should not import Hapi or Boom in %s',
    (file) => {
      const source = readFileSync(join(directory, file), 'utf8')

      expect(source).not.toContain('@hapi/hapi')
      expect(source).not.toContain('@hapi/boom')
    }
  )
})
