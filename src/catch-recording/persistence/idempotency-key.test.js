import {
  MAX_IDEMPOTENCY_KEY_LENGTH,
  validateIdempotencyKey,
  assertBoundedPrintableToken
} from './idempotency-key.js'

describe('#idempotency-key', () => {
  describe('validateIdempotencyKey', () => {
    test('Should return a valid key unchanged', () => {
      expect(validateIdempotencyKey('client-generated-key-1')).toBe(
        'client-generated-key-1'
      )
    })

    test('Should accept a key at exactly the maximum length', () => {
      const key = 'a'.repeat(MAX_IDEMPOTENCY_KEY_LENGTH)
      expect(validateIdempotencyKey(key)).toBe(key)
    })

    test('Should not trim, case-convert, or otherwise transform the key', () => {
      const key = '  Mixed-Case-Key  '
      expect(validateIdempotencyKey(key)).toBe(key)
    })

    test.each([
      ['undefined', undefined],
      ['null', null],
      ['empty string', ''],
      ['a number', 123],
      ['an object', {}],
      ['an array', []],
      ['oversized key', 'a'.repeat(MAX_IDEMPOTENCY_KEY_LENGTH + 1)],
      ['embedded NUL', 'key\u0000withNul'],
      ['embedded newline', 'key\nwithNewline'],
      ['embedded tab', 'key\twithTab'],
      ['embedded DEL', 'key\u007Fwith-del'],
      ['operator-like object', { $ne: null }]
    ])('Should reject %s', (_description, value) => {
      expect(() => validateIdempotencyKey(value)).toThrow(TypeError)
    })
  })

  describe('assertBoundedPrintableToken', () => {
    test('Should return a valid token unchanged', () => {
      expect(assertBoundedPrintableToken('resource-1', 'resourceId', 50)).toBe(
        'resource-1'
      )
    })

    test('Should reject a token exceeding the supplied max length', () => {
      expect(() =>
        assertBoundedPrintableToken('a'.repeat(51), 'resourceId', 50)
      ).toThrow(TypeError)
    })

    test('Should reject an empty string', () => {
      expect(() => assertBoundedPrintableToken('', 'resourceId', 50)).toThrow(
        TypeError
      )
    })

    test('Should include the supplied field name in the error message', () => {
      expect(() => assertBoundedPrintableToken(123, 'customField', 50)).toThrow(
        /"customField"/
      )
    })
  })
})
