import { ApplicationError } from '#/common/helpers/errors/application-error.js'

const AUTHENTICATION_REQUIRED_MESSAGE =
  'Authentication is required to access this resource.'

/**
 * The one safe, generic authentication failure for the Entra path. Every cause (missing or malformed
 * credentials, an invalid token, a missing or malformed identity claim, an unavailable signing key) looks
 * identical publicly. The internal reason is a bounded category kept only in the non-serialised `meta`.
 *
 * @param {string} reason a bounded failure-reason constant
 * @returns {ApplicationError}
 */
export function entraAuthenticationError(reason) {
  return new ApplicationError({
    category: 'AUTHENTICATION_FAILURE',
    code: 'AUTHENTICATION_REQUIRED',
    message: AUTHENTICATION_REQUIRED_MESSAGE,
    meta: { reason }
  })
}
