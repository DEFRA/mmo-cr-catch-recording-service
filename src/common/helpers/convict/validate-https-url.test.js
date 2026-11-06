import { convictValidateHttpsUrl } from './validate-https-url.js'

describe('#convictValidateHttpsUrl', () => {
  test('With a valid absolute https URL, Should not throw', () => {
    expect(() =>
      convictValidateHttpsUrl.validate(
        'https://example.invalid/.well-known/openid-configuration'
      )
    ).not.toThrow()
  })

  test('With a non-HTTPS URL, Should throw', () => {
    expect(() =>
      convictValidateHttpsUrl.validate(
        'http://example.invalid/.well-known/openid-configuration'
      )
    ).toThrow()
  })

  test('With a malformed URL, Should throw', () => {
    expect(() => convictValidateHttpsUrl.validate('not-a-url')).toThrow()
  })

  test('With an empty string, Should throw', () => {
    expect(() => convictValidateHttpsUrl.validate('')).toThrow()
  })
})
