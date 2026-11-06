import { convictValidateBaseUrl } from './validate-base-url.js'

describe('#convictValidateBaseUrl', () => {
  test('With a valid absolute http URL, Should not throw', () => {
    expect(() =>
      convictValidateBaseUrl.validate('http://user-profile.example.invalid')
    ).not.toThrow()
  })

  test('With a valid absolute https URL, Should not throw', () => {
    expect(() =>
      convictValidateBaseUrl.validate('https://user-profile.example.invalid')
    ).not.toThrow()
  })

  test('With a malformed URL, Should throw', () => {
    expect(() => convictValidateBaseUrl.validate('not-a-url')).toThrow()
  })

  test('With an empty string, Should throw', () => {
    expect(() => convictValidateBaseUrl.validate('')).toThrow()
  })
})
