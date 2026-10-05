import { readFileSync } from 'node:fs'

import { calculateNextSubmissionNumber } from './submission-number.js'

describe('#calculateNextSubmissionNumber', () => {
  test('Should produce 1 from a current count of 0 (first submission)', () => {
    expect(calculateNextSubmissionNumber(0)).toBe(1)
  })

  test('Should produce 2 from a current count of 1', () => {
    expect(calculateNextSubmissionNumber(1)).toBe(2)
  })

  test('Should increment a larger valid count by exactly one', () => {
    expect(calculateNextSubmissionNumber(41)).toBe(42)
  })

  test('Should reject a negative value', () => {
    expect(calculateNextSubmissionNumber(-1)).toBeUndefined()
  })

  test('Should reject a fractional value', () => {
    expect(calculateNextSubmissionNumber(1.5)).toBeUndefined()
  })

  test('Should reject a numeric string', () => {
    expect(calculateNextSubmissionNumber('1')).toBeUndefined()
  })

  test('Should reject missing values', () => {
    expect(calculateNextSubmissionNumber(undefined)).toBeUndefined()
    expect(calculateNextSubmissionNumber(null)).toBeUndefined()
  })

  test('Should reject an unsafe integer value', () => {
    expect(
      calculateNextSubmissionNumber(Number.MAX_SAFE_INTEGER + 1)
    ).toBeUndefined()
  })

  test('Should accept the maximum safe integer', () => {
    expect(calculateNextSubmissionNumber(Number.MAX_SAFE_INTEGER)).toBe(
      Number.MAX_SAFE_INTEGER + 1
    )
  })

  test('Should reject NaN and Infinity', () => {
    expect(calculateNextSubmissionNumber(NaN)).toBeUndefined()
    expect(calculateNextSubmissionNumber(Infinity)).toBeUndefined()
  })

  test('Should be deterministic', () => {
    expect(calculateNextSubmissionNumber(5)).toBe(
      calculateNextSubmissionNumber(5)
    )
  })

  test('Should not mutate its input', () => {
    const input = 5
    calculateNextSubmissionNumber(input)
    expect(input).toBe(5)
  })

  test('Should not import Hapi, Boom, Joi, or MongoDB', () => {
    const source = readFileSync(
      new URL('./submission-number.js', import.meta.url),
      'utf8'
    )

    expect(source).not.toMatch(/from\s+['"]@hapi\/hapi['"]/)
    expect(source).not.toMatch(/from\s+['"]@hapi\/boom['"]/)
    expect(source).not.toMatch(/from\s+['"]joi['"]/)
    expect(source).not.toMatch(/from\s+['"]mongodb['"]/)
  })
})
