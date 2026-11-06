import { convictValidateAlgorithmAllowlist } from './validate-algorithm-allowlist.js'

describe('#convictValidateAlgorithmAllowlist', () => {
  describe('#coerce', () => {
    test('With a comma-separated string, Should split into an array', () => {
      expect(convictValidateAlgorithmAllowlist.coerce('RS256, RS256')).toEqual([
        'RS256',
        'RS256'
      ])
    })

    test('With an empty string, Should coerce to an empty array', () => {
      expect(convictValidateAlgorithmAllowlist.coerce('')).toEqual([])
    })

    test('With an array already, Should return it unchanged', () => {
      expect(convictValidateAlgorithmAllowlist.coerce(['RS256'])).toEqual([
        'RS256'
      ])
    })
  })

  describe('#validate', () => {
    test('With a valid RS256 allowlist, Should not throw', () => {
      expect(() =>
        convictValidateAlgorithmAllowlist.validate(['RS256'])
      ).not.toThrow()
    })

    test('With an empty array, Should throw', () => {
      expect(() => convictValidateAlgorithmAllowlist.validate([])).toThrow()
    })

    test('With a non-array value, Should throw', () => {
      expect(() =>
        convictValidateAlgorithmAllowlist.validate('RS256')
      ).toThrow()
    })

    test('With the "none" algorithm, Should throw', () => {
      expect(() =>
        convictValidateAlgorithmAllowlist.validate(['none'])
      ).toThrow()
    })

    test('With the "HS256" algorithm, Should throw', () => {
      expect(() =>
        convictValidateAlgorithmAllowlist.validate(['HS256'])
      ).toThrow()
    })

    test('With an unknown algorithm, Should throw', () => {
      expect(() =>
        convictValidateAlgorithmAllowlist.validate(['ES256'])
      ).toThrow()
    })
  })
})
