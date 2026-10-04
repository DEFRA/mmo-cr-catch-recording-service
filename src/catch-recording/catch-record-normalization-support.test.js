import { isApplicationError } from '#/common/helpers/errors/application-error.js'

import {
  assertAllowedKeys,
  assertNoServerOwnedFields
} from './catch-record-normalization-support.js'
import { CATCH_RECORD_SERVER_OWNED_FIELDS } from './canonical-catch-record-server-owned-fields.js'

describe('#assertAllowedKeys', () => {
  test('Should not throw for an exact allow-listed set', () => {
    expect(() => assertAllowedKeys({ a: 1, b: 2 }, ['a', 'b'])).not.toThrow()
  })

  test('Should throw an ApplicationError for an unknown key', () => {
    try {
      assertAllowedKeys({ a: 1, unknown: true }, ['a'])
      throw new Error('Expected assertAllowedKeys to throw')
    } catch (error) {
      expect(isApplicationError(error)).toBe(true)
      expect(error.category).toBe('INVALID_REQUEST')
      expect(error.details.map((d) => d.path)).toEqual(['unknown'])
    }
  })

  test('Should use the supplied code when provided', () => {
    try {
      assertAllowedKeys({ unknown: true }, [], { code: 'CUSTOM_CODE' })
      throw new Error('Expected assertAllowedKeys to throw')
    } catch (error) {
      expect(error.code).toBe('CUSTOM_CODE')
    }
  })

  test('Should ignore inherited/prototype properties', () => {
    const base = { inherited: true }
    const candidate = Object.create(base)
    candidate.a = 1

    expect(() => assertAllowedKeys(candidate, ['a'])).not.toThrow()
  })

  test('Should not mutate the candidate', () => {
    const candidate = { a: 1, unknown: true }
    const snapshot = { ...candidate }

    try {
      assertAllowedKeys(candidate, ['a'])
    } catch {
      // expected
    }

    expect(candidate).toEqual(snapshot)
  })

  test('Should not include the offending value in error details, only the field name', () => {
    try {
      assertAllowedKeys({ secret: 'super-secret-value' }, [])
      throw new Error('Expected assertAllowedKeys to throw')
    } catch (error) {
      expect(JSON.stringify(error.details)).not.toContain('super-secret-value')
    }
  })
})

describe('#assertNoServerOwnedFields', () => {
  test.each(CATCH_RECORD_SERVER_OWNED_FIELDS)(
    'Should reject the server-owned field "%s"',
    (field) => {
      try {
        assertNoServerOwnedFields({ [field]: 'client-supplied' })
        throw new Error('Expected assertNoServerOwnedFields to throw')
      } catch (error) {
        expect(isApplicationError(error)).toBe(true)
        expect(error.code).toBe('SERVER_OWNED_FIELD_NOT_ALLOWED')
        expect(error.details.map((d) => d.path)).toContain(field)
      }
    }
  )

  test('Should not throw for client-owned business sections', () => {
    expect(() =>
      assertNoServerOwnedFields({
        vessel: {},
        trip: {},
        pairFishing: {},
        gear: [],
        retainedCatch: {}
      })
    ).not.toThrow()
  })

  test('Should not mutate the candidate', () => {
    const candidate = { id: 'client-supplied', vessel: {} }
    const snapshot = { ...candidate }

    try {
      assertNoServerOwnedFields(candidate)
    } catch {
      // expected
    }

    expect(candidate).toEqual(snapshot)
  })
})
