import { readFileSync } from 'node:fs'

import { normaliseTrimmedString } from './primitives.js'

describe('#normaliseTrimmedString', () => {
  test('Should trim leading and trailing whitespace', () => {
    expect(normaliseTrimmedString('  hello  ')).toBe('hello')
  })

  test('Should preserve internal whitespace', () => {
    expect(normaliseTrimmedString('  hello   world  ')).toBe('hello   world')
  })

  test('Should preserve case', () => {
    expect(normaliseTrimmedString('  MixedCase  ')).toBe('MixedCase')
  })

  test('Should preserve unicode content', () => {
    expect(normaliseTrimmedString('  Plymouth – Café  ')).toBe(
      'Plymouth – Café'
    )
  })

  test('Should return an empty string unchanged', () => {
    expect(normaliseTrimmedString('')).toBe('')
  })

  test('Should return a whitespace-only string trimmed to empty', () => {
    expect(normaliseTrimmedString('   ')).toBe('')
  })

  test('Should return null unchanged', () => {
    expect(normaliseTrimmedString(null)).toBeNull()
  })

  test('Should return undefined unchanged', () => {
    expect(normaliseTrimmedString(undefined)).toBeUndefined()
  })

  test.each([42, true, false, { a: 1 }, ['x'], NaN])(
    'Should return a non-string value (%p) unchanged without coercion',
    (value) => {
      expect(normaliseTrimmedString(value)).toBe(value)
    }
  )

  test('Should not mutate or wrap the input value', () => {
    const input = '  immutable  '
    const result = normaliseTrimmedString(input)

    expect(input).toBe('  immutable  ')
    expect(result).toBe('immutable')
  })

  test('Should not import Hapi, Boom, Joi, or MongoDB', () => {
    const source = readFileSync(
      new URL('./primitives.js', import.meta.url),
      'utf8'
    )

    expect(source).not.toMatch(/from\s+['"]@hapi\/hapi['"]/)
    expect(source).not.toMatch(/from\s+['"]@hapi\/boom['"]/)
    expect(source).not.toMatch(/from\s+['"]joi['"]/)
    expect(source).not.toMatch(/from\s+['"]mongodb['"]/)
  })
})
