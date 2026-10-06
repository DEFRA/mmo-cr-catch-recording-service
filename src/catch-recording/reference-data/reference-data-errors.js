import { ApplicationError } from '#/common/helpers/errors/application-error.js'

/**
 * The approved, stable set of framework-neutral errors used throughout the Reference Data Service
 * client. Reuses the exact existing Step 03 categories (`INVALID_REQUEST`, `RESOURCE_NOT_FOUND`,
 * `UPSTREAM_INVALID_RESPONSE`, `DEPENDENCY_UNAVAILABLE`, `UPSTREAM_TIMEOUT`) - no new category is added.
 * Never includes the raw stable ID, the request path, the Reference Data Service URL, the service
 * credential, or the raw upstream response body in a public message. `cause` carries the real internal
 * reason for logs only - `ApplicationError` keeps it non-enumerable.
 */

/**
 * @param {string} message
 * @returns {ApplicationError}
 */
export function invalidReferenceRequestError(message) {
  return new ApplicationError({
    category: 'INVALID_REQUEST',
    message
  })
}

/**
 * @param {string} resourceType e.g. 'vessel', 'gear', 'port', 'species', 'statistical area'
 * @returns {ApplicationError}
 */
export function referenceItemNotFoundError(resourceType) {
  return new ApplicationError({
    category: 'RESOURCE_NOT_FOUND',
    message: `The requested ${resourceType} reference could not be found.`
  })
}

/**
 * @param {unknown} [cause]
 * @returns {ApplicationError}
 */
export function upstreamInvalidResponseError(cause) {
  return new ApplicationError({
    category: 'UPSTREAM_INVALID_RESPONSE',
    message: 'The Reference Data Service returned an unexpected response.',
    cause
  })
}

/**
 * @param {unknown} [cause]
 * @returns {ApplicationError}
 */
export function dependencyUnavailableError(cause) {
  return new ApplicationError({
    category: 'DEPENDENCY_UNAVAILABLE',
    message: 'The Reference Data Service is currently unavailable.',
    cause
  })
}

/**
 * @param {unknown} [cause]
 * @returns {ApplicationError}
 */
export function upstreamTimeoutError(cause) {
  return new ApplicationError({
    category: 'UPSTREAM_TIMEOUT',
    message: 'The Reference Data Service did not respond in time.',
    cause
  })
}
