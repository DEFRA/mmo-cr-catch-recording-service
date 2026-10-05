/**
 * Approved Catch Recording Service application-error category catalogue.
 *
 * Each category carries the HTTP status it maps to and the stable fallback application code used when
 * a specific business code is not supplied. This catalogue is exact and must not be extended without an
 * approved, demonstrated HTTP-semantic need (see `design/architecture/catch-recording-error-handling.md`).
 */

const ERROR_CATEGORIES = Object.freeze({
  INVALID_REQUEST: Object.freeze({
    status: 400,
    fallbackCode: 'INVALID_REQUEST'
  }),
  AUTHENTICATION_FAILURE: Object.freeze({
    status: 401,
    fallbackCode: 'AUTHENTICATION_REQUIRED'
  }),
  AUTHORISATION_FAILURE: Object.freeze({
    status: 403,
    fallbackCode: 'ACCESS_DENIED'
  }),
  RESOURCE_NOT_FOUND: Object.freeze({
    status: 404,
    fallbackCode: 'RESOURCE_NOT_FOUND'
  }),
  VERSION_CONFLICT: Object.freeze({
    status: 409,
    fallbackCode: 'VERSION_CONFLICT'
  }),
  INVALID_LIFECYCLE_TRANSITION: Object.freeze({
    status: 409,
    fallbackCode: 'INVALID_LIFECYCLE_TRANSITION'
  }),
  DUPLICATE_RESOURCE: Object.freeze({
    status: 409,
    fallbackCode: 'DUPLICATE_RESOURCE'
  }),
  IDEMPOTENCY_CONFLICT: Object.freeze({
    status: 409,
    fallbackCode: 'IDEMPOTENCY_CONFLICT'
  }),
  BUSINESS_VALIDATION_FAILURE: Object.freeze({
    status: 422,
    fallbackCode: 'BUSINESS_VALIDATION_FAILED'
  }),
  UPSTREAM_INVALID_RESPONSE: Object.freeze({
    status: 502,
    fallbackCode: 'UPSTREAM_INVALID_RESPONSE'
  }),
  DEPENDENCY_UNAVAILABLE: Object.freeze({
    status: 503,
    fallbackCode: 'DEPENDENCY_UNAVAILABLE'
  }),
  UPSTREAM_TIMEOUT: Object.freeze({
    status: 504,
    fallbackCode: 'UPSTREAM_TIMEOUT'
  }),
  ARTIFACT_OPERATION_FAILURE: Object.freeze({
    status: 500,
    fallbackCode: 'ARTIFACT_OPERATION_FAILED'
  }),
  UNEXPECTED_INTERNAL_FAILURE: Object.freeze({
    status: 500,
    fallbackCode: 'INTERNAL_SERVER_ERROR'
  })
})

export function isSupportedCategory(category) {
  return (
    typeof category === 'string' && Object.hasOwn(ERROR_CATEGORIES, category)
  )
}

export function getCategoryDefinition(category) {
  if (!isSupportedCategory(category)) {
    return undefined
  }

  return ERROR_CATEGORIES[category]
}

export { ERROR_CATEGORIES }
