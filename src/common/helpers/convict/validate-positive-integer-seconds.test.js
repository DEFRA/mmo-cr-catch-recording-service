import { convictValidatePositiveIntegerSeconds } from './validate-positive-integer-seconds.js'

describe('#convictValidatePositiveIntegerSeconds', () => {
  describe('#coerce', () => {
    test('With a numeric string, Should coerce to a number', () => {
      expect(convictValidatePositiveIntegerSeconds.coerce('600')).toBe(600)
    })

    test('With a number already, Should return it unchanged', () => {
      expect(convictValidatePositiveIntegerSeconds.coerce(600)).toBe(600)
    })
  })

  describe('#validate', () => {
    test('With a valid positive integer, Should not throw', () => {
      expect(() =>
        convictValidatePositiveIntegerSeconds.validate(600)
      ).not.toThrow()
    })

    test('With zero, Should throw', () => {
      expect(() => convictValidatePositiveIntegerSeconds.validate(0)).toThrow()
    })

    test('With a negative value, Should throw', () => {
      expect(() => convictValidatePositiveIntegerSeconds.validate(-1)).toThrow()
    })

    test('With a fractional value, Should throw', () => {
      expect(() =>
        convictValidatePositiveIntegerSeconds.validate(600.5)
      ).toThrow()
    })

    test('With a malformed (non-numeric) value, Should throw', () => {
      expect(() =>
        convictValidatePositiveIntegerSeconds.validate(Number('not-a-number'))
      ).toThrow()
    })

    test('With an overflow value, Should throw', () => {
      expect(() =>
        convictValidatePositiveIntegerSeconds.validate(
          Number.MAX_SAFE_INTEGER + 1000
        )
      ).toThrow()
    })
  })
})
