import {
  VALIDATION_CODES,
  isValidationCode
} from './catch-record-validation-codes.js'

describe('VALIDATION_CODES', () => {
  test('Should contain exactly the approved, non-speculative codes', () => {
    expect(VALIDATION_CODES).toEqual([
      'REQUIRED_FIELD',
      'INVALID_TYPE',
      'INVALID_FORMAT',
      'INVALID_IDENTIFIER',
      'INVALID_DATE',
      'INVALID_TIMESTAMP',
      'INVALID_NUMBER',
      'INVALID_BOOLEAN',
      'INVALID_ENUM_VALUE',
      'EMPTY_VALUE',
      'DUPLICATE_VALUE',
      'DUPLICATE_RELATIONSHIP',
      'COLLECTION_TOO_SMALL',
      'COLLECTION_TOO_LARGE',
      'UNKNOWN_FIELD',
      'PROTECTED_FIELD',
      'CONDITIONAL_FIELD_REQUIRED',
      'CONDITIONAL_FIELD_PROHIBITED',
      'INCONSISTENT_FIELDS'
    ])
  })

  test('Should be frozen', () => {
    expect(Object.isFrozen(VALIDATION_CODES)).toBe(true)
  })
})

describe('#isValidationCode', () => {
  test('Should accept an approved code', () => {
    expect(isValidationCode('REQUIRED_FIELD')).toBe(true)
  })

  test('Should reject an unapproved/speculative code', () => {
    expect(isValidationCode('GEAR_IS_WRONG_COLOUR')).toBe(false)
  })
})
