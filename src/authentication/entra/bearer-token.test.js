import { BearerTokenFailure, extractBearerToken } from './bearer-token.js'

describe('#extractBearerToken', () => {
  test.each([
    ['Bearer abc.def.ghi', 'abc.def.ghi'],
    ['bearer abc.def.ghi', 'abc.def.ghi'],
    ['Bearer a-b_c.d~e+f/g==', 'a-b_c.d~e+f/g==']
  ])('Should return the credential unchanged from %j', (header, token) => {
    expect(extractBearerToken(header)).toEqual({ ok: true, token })
  })

  test.each([[undefined], ['']])(
    'Should report a missing header for %j',
    (header) => {
      expect(extractBearerToken(header)).toEqual({
        ok: false,
        reason: BearerTokenFailure.MISSING_AUTHORIZATION_HEADER
      })
    }
  )

  test.each([['Basic dXNlcjpwYXNz'], ['Digest abc'], ['Token abc'], ['abc']])(
    'Should reject the unsupported scheme in %j',
    (header) => {
      expect(extractBearerToken(header)).toMatchObject({
        reason: BearerTokenFailure.UNSUPPORTED_AUTHENTICATION_SCHEME
      })
    }
  )

  test.each([
    ['Bearer'],
    ['Bearer '],
    ['Bearer  abc'],
    ['Bearer abc '],
    ['Bearer abc def'],
    ['Bearer ab\tc'],
    ['Bearer a$b'],
    ['Bearer =abc'],
    ['123 abc'],
    [['Bearer a', 'Bearer b']],
    [42]
  ])('Should reject the malformed header %j', (header) => {
    expect(extractBearerToken(header)).toEqual({
      ok: false,
      reason: BearerTokenFailure.MALFORMED_AUTHORIZATION_HEADER
    })
  })
})
