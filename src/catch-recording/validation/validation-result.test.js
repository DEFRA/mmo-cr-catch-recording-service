import { readFileSync } from 'node:fs'

import {
  combineResults,
  createInvalidResult,
  createValidResult,
  formatPath
} from './validation-result.js'

describe('#formatPath', () => {
  test('Should join segments with a dot, including numeric indexes', () => {
    expect(formatPath(['gears', 0, 'speciesCaught', 0, 'species', 'id'])).toBe(
      'gears.0.speciesCaught.0.species.id'
    )
  })

  test('Should format a single-segment path', () => {
    expect(formatPath(['status'])).toBe('status')
  })
})

describe('#createValidResult', () => {
  test('Should return a valid result with no issues', () => {
    expect(createValidResult()).toEqual({ valid: true, issues: [] })
  })

  test('Should be frozen', () => {
    const result = createValidResult()

    expect(Object.isFrozen(result)).toBe(true)
    expect(Object.isFrozen(result.issues)).toBe(true)
  })
})

describe('#createInvalidResult', () => {
  test('Should build an invalid result from a single issue', () => {
    const result = createInvalidResult({
      code: 'REQUIRED',
      path: 'gears.0.associationId'
    })

    expect(result.valid).toBe(false)
    expect(result.issues).toEqual([
      { code: 'REQUIRED', path: 'gears.0.associationId' }
    ])
  })

  test('Should build an invalid result from multiple issues, preserving order', () => {
    const result = createInvalidResult([
      { code: 'REQUIRED', path: 'a' },
      { code: 'REQUIRED', path: 'b' }
    ])

    expect(result.issues.map((issue) => issue.path)).toEqual(['a', 'b'])
  })

  test('Should deduplicate identical issues', () => {
    const result = createInvalidResult([
      { code: 'REQUIRED', path: 'a' },
      { code: 'REQUIRED', path: 'a' }
    ])

    expect(result.issues).toHaveLength(1)
  })

  test('Should preserve distinct issues with the same code and path but a different message', () => {
    const result = createInvalidResult([
      { code: 'UNSUPPORTED_VALUE', path: 'status', message: 'first' },
      { code: 'UNSUPPORTED_VALUE', path: 'status', message: 'second' }
    ])

    expect(result.issues).toHaveLength(2)
  })

  test('Should return a valid result when given an empty issue list', () => {
    expect(createInvalidResult([])).toEqual({ valid: true, issues: [] })
  })

  test('Should be frozen, including each issue', () => {
    const result = createInvalidResult({ code: 'REQUIRED', path: 'a' })

    expect(Object.isFrozen(result)).toBe(true)
    expect(Object.isFrozen(result.issues)).toBe(true)
    expect(Object.isFrozen(result.issues[0])).toBe(true)
  })

  test('Should not include a rejected value, cause, or HTTP status in an issue', () => {
    const result = createInvalidResult({ code: 'REQUIRED', path: 'a' })

    expect(result.issues[0]).not.toHaveProperty('value')
    expect(result.issues[0]).not.toHaveProperty('cause')
    expect(result.issues[0]).not.toHaveProperty('statusCode')
  })
})

describe('#combineResults', () => {
  test('Should be valid when every supplied result is valid', () => {
    expect(combineResults(createValidResult(), createValidResult())).toEqual({
      valid: true,
      issues: []
    })
  })

  test('Should combine issues in call order', () => {
    const result = combineResults(
      createInvalidResult({ code: 'REQUIRED', path: 'a' }),
      createInvalidResult({ code: 'REQUIRED', path: 'b' })
    )

    expect(result.issues.map((issue) => issue.path)).toEqual(['a', 'b'])
  })

  test('Should deduplicate an issue reported by more than one combined result', () => {
    const result = combineResults(
      createInvalidResult({ code: 'REQUIRED', path: 'a' }),
      createInvalidResult({ code: 'REQUIRED', path: 'a' })
    )

    expect(result.issues).toHaveLength(1)
  })

  test('Should be invalid when any supplied result is invalid', () => {
    const result = combineResults(
      createValidResult(),
      createInvalidResult({ code: 'REQUIRED', path: 'a' })
    )

    expect(result.valid).toBe(false)
  })

  test('Should not mutate any supplied result', () => {
    const first = createInvalidResult({ code: 'REQUIRED', path: 'a' })
    const second = createValidResult()

    combineResults(first, second)

    expect(first.issues).toHaveLength(1)
    expect(second.issues).toHaveLength(0)
  })

  test('Should not import Hapi, Boom, Joi, or MongoDB', () => {
    const source = readFileSync(
      new URL('./validation-result.js', import.meta.url),
      'utf8'
    )

    expect(source).not.toMatch(/from\s+['"]@hapi\/hapi['"]/)
    expect(source).not.toMatch(/from\s+['"]@hapi\/boom['"]/)
    expect(source).not.toMatch(/from\s+['"]joi['"]/)
    expect(source).not.toMatch(/from\s+['"]mongodb['"]/)
  })
})
