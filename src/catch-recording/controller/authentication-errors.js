import { ApplicationError } from '#/common/helpers/errors/application-error.js'

/**
 * The one safe, stable authentication failure shape used by both `authentication-client.js` and
 * `authentication-context.js`. Every Step 13 failure mode (missing token, unconfigured or unavailable
 * Authentication Service, a non-2xx response, a timeout, a network error, or a malformed success body)
 * collapses to this same category/code/message, per the approved decision in
 * `docs/configuration-decisions.md` ("Phase 4 decisions" - Step 13). `cause` carries the real internal
 * reason for logs only - `ApplicationError` keeps it non-enumerable and it is never publicly serialised.
 *
 * @param {unknown} [cause]
 * @returns {ApplicationError}
 */
export function authenticationRequiredError(cause) {
  return new ApplicationError({
    category: 'AUTHENTICATION_FAILURE',
    code: 'AUTHENTICATION_REQUIRED',
    message: 'Authentication is required to access this resource.',
    cause
  })
}
