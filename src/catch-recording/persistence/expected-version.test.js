import {
  MIN_EXPECTED_VERSION,
  validateExpectedVersion
} from './expected-version.js'

describe('#expected-version', () => {
  describe('validateExpectedVersion', () => {
    test('Should accept the lowest valid canonical version', () => {
      expect(validateExpectedVersion(MIN_EXPECTED_VERSION)).toBe(1)
    })

    test('Should accept a representative higher version unchanged', () => {
      expect(validateExpectedVersion(42)).toBe(42)
    })

    test.each([
      ['missing (undefined)', undefined],
      ['null', null],
      ['negative', -1],
      ['zero', 0],
      ['fractional', 1.5],
      ['NaN', Number.NaN],
      ['positive Infinity', Number.POSITIVE_INFINITY],
      ['negative Infinity', Number.NEGATIVE_INFINITY],
      ['an unsafe integer', Number.MAX_SAFE_INTEGER + 1],
      ['a numeric string', '1'],
      ['an object', { version: 1 }],
      ['an array', [1]],
      ['an operator-like object', { $gt: 0 }]
    ])('Should reject %s', (_description, value) => {
      expect(() => validateExpectedVersion(value)).toThrow(TypeError)
    })

    test('Should not mutate or coerce the supplied value', () => {
      const input = 7
      const result = validateExpectedVersion(input)

      expect(result).toBe(input)
    })
  })
})
