import {
  isNonEmptyString,
  isNullableString,
  isFiniteNumber,
  isNullableFiniteNumber,
  isBoolean,
  isStringArray,
  isPlainObject
} from './response-validators.js'

describe('#response-validators', () => {
  test('isNonEmptyString', () => {
    expect(isNonEmptyString('x')).toBe(true)
    expect(isNonEmptyString('')).toBe(false)
    expect(isNonEmptyString(null)).toBe(false)
    expect(isNonEmptyString(42)).toBe(false)
  })

  test('isNullableString', () => {
    expect(isNullableString(null)).toBe(true)
    expect(isNullableString('x')).toBe(true)
    expect(isNullableString('')).toBe(false)
    expect(isNullableString(undefined)).toBe(false)
  })

  test('isFiniteNumber', () => {
    expect(isFiniteNumber(1.5)).toBe(true)
    expect(isFiniteNumber(Infinity)).toBe(false)
    expect(isFiniteNumber(NaN)).toBe(false)
    expect(isFiniteNumber('1')).toBe(false)
  })

  test('isNullableFiniteNumber', () => {
    expect(isNullableFiniteNumber(null)).toBe(true)
    expect(isNullableFiniteNumber(1)).toBe(true)
    expect(isNullableFiniteNumber('1')).toBe(false)
  })

  test('isBoolean', () => {
    expect(isBoolean(true)).toBe(true)
    expect(isBoolean(false)).toBe(true)
    expect(isBoolean('true')).toBe(false)
  })

  test('isStringArray', () => {
    expect(isStringArray(['a', 'b'])).toBe(true)
    expect(isStringArray([])).toBe(true)
    expect(isStringArray(['a', ''])).toBe(false)
    expect(isStringArray('a')).toBe(false)
    expect(isStringArray([1])).toBe(false)
  })

  test('isPlainObject', () => {
    expect(isPlainObject({})).toBe(true)
    expect(isPlainObject([])).toBe(false)
    expect(isPlainObject(null)).toBe(false)
    expect(isPlainObject('x')).toBe(false)
  })
})
