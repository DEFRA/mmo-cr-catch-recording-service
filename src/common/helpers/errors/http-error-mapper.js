import { isApplicationError } from './application-error.js'
import { getCategoryDefinition } from './error-categories.js'
import { sanitiseDetails } from './sanitise-details.js'

/**
 * Central, framework-neutral HTTP error mapper.
 *
 * Maps, in order: `ApplicationError` -> Joi/Hapi validation failure -> existing Boom error ->
 * unexpected/malformed error, to a safe `{ statusCode, payload, headers }` result. Never throws: any
 * failure while mapping falls back to the same fixed generic 500 response
 * (`design/architecture/catch-recording-error-handling.md` §6.4, §8). Duck-types the Hapi/Boom response
 * shape (`isBoom`, `output`) rather than importing either framework package, keeping this module
 * framework-neutral.
 */

const VALIDATION_MESSAGE = 'The request is invalid.'
const UNEXPECTED_MESSAGE = 'An unexpected error occurred.'
const UNEXPECTED_STATUS = 500
const UNEXPECTED_CODE = 'INTERNAL_SERVER_ERROR'

const BOOM_STATUS_FALLBACK_CODE = Object.freeze({
  400: 'INVALID_REQUEST',
  401: 'AUTHENTICATION_REQUIRED',
  403: 'ACCESS_DENIED',
  404: 'RESOURCE_NOT_FOUND',
  // Per the approved error-handling plan, an unclassified 409 uses the generic conflict code rather
  // than guessing one of the four 409 business categories (VERSION_CONFLICT, DUPLICATE_RESOURCE, etc).
  409: 'CONFLICT',
  422: 'BUSINESS_VALIDATION_FAILED',
  500: UNEXPECTED_CODE,
  502: 'UPSTREAM_INVALID_RESPONSE',
  503: 'DEPENDENCY_UNAVAILABLE',
  504: 'UPSTREAM_TIMEOUT'
})

function buildPayload({ statusCode, code, message, correlationId, details }) {
  return {
    statusCode,
    code,
    message,
    ...(correlationId ? { correlationId } : {}),
    ...(details && details.length > 0 ? { details } : {})
  }
}

function mapUnexpectedError(correlationId) {
  return {
    statusCode: UNEXPECTED_STATUS,
    payload: buildPayload({
      statusCode: UNEXPECTED_STATUS,
      code: UNEXPECTED_CODE,
      message: UNEXPECTED_MESSAGE,
      correlationId
    }),
    headers: {}
  }
}

function mapApplicationError(error, correlationId) {
  const definition = getCategoryDefinition(error.category)

  // Defensive: the ApplicationError constructor already validates its category, but a caller could
  // still mutate an instance after construction. Fail safe rather than trust a stale definition.
  if (!definition) {
    return mapUnexpectedError(correlationId)
  }

  return {
    statusCode: definition.status,
    payload: buildPayload({
      statusCode: definition.status,
      code: error.code,
      message: error.message,
      correlationId,
      details: error.details
    }),
    headers: {}
  }
}

function isValidationFailure(error) {
  return (
    Boolean(error?.isBoom) && error.output?.payload?.validation !== undefined
  )
}

function mapValidationFailure(error, correlationId) {
  const rawDetails = Array.isArray(error.details)
    ? error.details.map((detail) => ({
        path: detail?.path,
        code: detail?.type
      }))
    : undefined

  return {
    statusCode: 400,
    payload: buildPayload({
      statusCode: 400,
      code: 'INVALID_REQUEST',
      message: VALIDATION_MESSAGE,
      correlationId,
      details: sanitiseDetails(rawDetails)
    }),
    headers: {}
  }
}

function boomFallbackCode(error, statusCode) {
  if (
    typeof error?.data?.code === 'string' &&
    error.data.code.trim().length > 0
  ) {
    return error.data.code
  }

  return BOOM_STATUS_FALLBACK_CODE[statusCode] ?? `HTTP_${statusCode}`
}

function mapBoomError(error, correlationId) {
  const statusCode = error.output.statusCode

  return {
    statusCode,
    payload: buildPayload({
      statusCode,
      code: boomFallbackCode(error, statusCode),
      message: error.output.payload.message,
      correlationId
    }),
    headers: { ...error.output.headers }
  }
}

export function mapErrorToResponse(error, correlationId) {
  try {
    if (isApplicationError(error)) {
      return mapApplicationError(error, correlationId)
    }

    if (isValidationFailure(error)) {
      return mapValidationFailure(error, correlationId)
    }

    if (error?.isBoom) {
      return mapBoomError(error, correlationId)
    }

    return mapUnexpectedError(correlationId)
  } catch {
    return mapUnexpectedError(correlationId)
  }
}
