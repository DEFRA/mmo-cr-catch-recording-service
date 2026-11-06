import { convictValidateNonEmptyString } from './validate-non-empty-string.js'

describe('#convictValidateNonEmptyString', () => {
  test('With a non-empty string, Should not throw', () => {
    expect(() =>
      convictValidateNonEmptyString.validate('vessel_roles')
    ).not.toThrow()
  })

  test('With an empty string, Should throw', () => {
    expect(() => convictValidateNonEmptyString.validate('')).toThrow()
  })

  test('With a whitespace-only string, Should throw', () => {
    expect(() => convictValidateNonEmptyString.validate('   ')).toThrow()
  })

  test('With a non-string value, Should throw', () => {
    expect(() => convictValidateNonEmptyString.validate(123)).toThrow()
  })
})
