import { authenticationRequiredError } from './authentication-errors.js'
import { isApplicationError } from '#/common/helpers/errors/application-error.js'

describe('#authenticationRequiredError', () => {
  test('Should produce a stable AUTHENTICATION_FAILURE/AUTHENTICATION_REQUIRED ApplicationError', () => {
    const error = authenticationRequiredError()

    expect(isApplicationError(error)).toBe(true)
    expect(error.category).toBe('AUTHENTICATION_FAILURE')
    expect(error.code).toBe('AUTHENTICATION_REQUIRED')
    expect(error.message).toBe(
      'Authentication is required to access this resource.'
    )
  })

  test('Should keep the same safe message regardless of the supplied cause', () => {
    const withCause = authenticationRequiredError(new Error('internal reason'))
    const withoutCause = authenticationRequiredError()

    expect(withCause.message).toBe(withoutCause.message)
    expect(withCause.code).toBe(withoutCause.code)
  })

  test('Should never serialise the internal cause publicly', () => {
    const error = authenticationRequiredError(
      new Error('SENTINEL-INTERNAL-REASON')
    )

    expect(JSON.stringify(error.toJSON())).not.toContain(
      'SENTINEL-INTERNAL-REASON'
    )
    expect(Object.keys(error)).not.toContain('cause')
  })
})
