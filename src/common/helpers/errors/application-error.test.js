import { ApplicationError, isApplicationError } from './application-error.js'
import { readFileSync } from 'node:fs'

describe('#ApplicationError', () => {
  test('Should construct with required values and default to the category fallback code', () => {
    const error = new ApplicationError({
      category: 'RESOURCE_NOT_FOUND',
      message: 'Catch record not found'
    })

    expect(error.category).toBe('RESOURCE_NOT_FOUND')
    expect(error.code).toBe('RESOURCE_NOT_FOUND')
    expect(error.message).toBe('Catch record not found')
    expect(error.details).toBeUndefined()
  })

  test('Should allow a specific stable code to override the fallback code', () => {
    const error = new ApplicationError({
      category: 'RESOURCE_NOT_FOUND',
      code: 'CATCH_RECORD_NOT_FOUND',
      message: 'Catch record not found'
    })

    expect(error.code).toBe('CATCH_RECORD_NOT_FOUND')
  })

  test('Should reject an unsupported category', () => {
    expect(
      () =>
        new ApplicationError({
          category: 'NOT_A_CATEGORY',
          message: 'Should not construct'
        })
    ).toThrow(/Unsupported application error category/)
  })

  test('Should reject an empty message', () => {
    expect(
      () =>
        new ApplicationError({
          category: 'INVALID_REQUEST',
          message: ''
        })
    ).toThrow(/non-empty public-safe message/)

    expect(
      () =>
        new ApplicationError({
          category: 'INVALID_REQUEST',
          message: '   '
        })
    ).toThrow(/non-empty public-safe message/)
  })

  test('Should sanitise optional details and omit unsupported fields', () => {
    const error = new ApplicationError({
      category: 'BUSINESS_VALIDATION_FAILURE',
      message: 'Invalid catch record',
      details: [
        { path: ['gears', 0, 'species'], code: 'DUPLICATE_SPECIES' },
        { path: 'unsafe', value: 'should be dropped' }
      ]
    })

    expect(error.details).toEqual([
      { path: 'gears.0.species', code: 'DUPLICATE_SPECIES' },
      { path: 'unsafe' }
    ])
  })

  test('Should keep cause and meta internal and non-enumerable', () => {
    const cause = new Error('internal database failure')
    const meta = { collection: 'catch-records' }

    const error = new ApplicationError({
      category: 'UNEXPECTED_INTERNAL_FAILURE',
      message: 'Something went wrong',
      cause,
      meta
    })

    expect(error.cause).toBe(cause)
    expect(error.meta).toBe(meta)
    expect(Object.keys(error)).not.toContain('cause')
    expect(Object.keys(error)).not.toContain('meta')
    expect(JSON.stringify(error)).not.toContain('internal database failure')
    expect(JSON.stringify(error)).not.toContain('catch-records')
  })

  test('Should not mutate the caller-supplied details array', () => {
    const details = [{ path: 'field', code: 'REQUIRED' }]
    const error = new ApplicationError({
      category: 'INVALID_REQUEST',
      message: 'Invalid',
      details
    })

    expect(details).toEqual([{ path: 'field', code: 'REQUIRED' }])
    expect(error.details).not.toBe(details)
  })

  test('Should serialise safely, excluding cause and meta', () => {
    const error = new ApplicationError({
      category: 'INVALID_REQUEST',
      message: 'Invalid request',
      details: [{ path: 'field', code: 'REQUIRED' }],
      cause: new Error('internal'),
      meta: { secret: 'value' }
    })

    expect(error.toJSON()).toEqual({
      category: 'INVALID_REQUEST',
      code: 'INVALID_REQUEST',
      message: 'Invalid request',
      details: [{ path: 'field', code: 'REQUIRED' }]
    })
  })

  test('Should reliably identify an ApplicationError instance', () => {
    const error = new ApplicationError({
      category: 'INVALID_REQUEST',
      message: 'Invalid'
    })

    expect(isApplicationError(error)).toBe(true)
    expect(isApplicationError(new Error('plain error'))).toBe(false)
    expect(
      isApplicationError({ category: 'INVALID_REQUEST', message: 'lookalike' })
    ).toBe(false)
    expect(isApplicationError(undefined)).toBe(false)
    expect(isApplicationError(null)).toBe(false)
  })

  test('Should not import Hapi or Boom', () => {
    const source = readFileSync(
      new URL('./application-error.js', import.meta.url),
      'utf8'
    )

    expect(source).not.toMatch(/from\s+['"]@hapi\/hapi['"]/)
    expect(source).not.toMatch(/from\s+['"]@hapi\/boom['"]/)
  })
})
