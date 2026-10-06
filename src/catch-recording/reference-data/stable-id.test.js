import { isValidStableId } from './stable-id.js'

describe('#isValidStableId', () => {
  test('Should accept a reasonable stable ID', () => {
    expect(isValidStableId('0fe4d4aa-22f8-449e-89c9-b7052bae8667')).toBe(true)
    expect(isValidStableId('vessel-1')).toBe(true)
  })

  test.each([undefined, null, 42, {}, [], true])(
    'Should reject a non-string value: %p',
    (value) => {
      expect(isValidStableId(value)).toBe(false)
    }
  )

  test('Should reject an empty string', () => {
    expect(isValidStableId('')).toBe(false)
  })

  test('Should reject an oversized identifier', () => {
    expect(isValidStableId('a'.repeat(101))).toBe(false)
  })

  test.each([
    '../etc/passwd',
    'vessel/1',
    'vessel\\1',
    'vessel?x=1',
    'vessel#frag',
    'https://evil.example/x',
    'a..b'
  ])('Should reject path-traversal or query-like content: %s', (value) => {
    expect(isValidStableId(value)).toBe(false)
  })

  test('Should reject control characters', () => {
    expect(isValidStableId('vessel-1\u0000')).toBe(false)
    expect(isValidStableId('vessel-1\n')).toBe(false)
  })
})
