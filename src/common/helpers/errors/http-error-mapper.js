import Boom from '@hapi/boom'
import { getTraceId } from '@defra/hapi-tracing'

import { isApplicationError } from './application-error.js'
import { CATEGORY_HTTP_STATUS } from './error-categories.js'
import { buildSafeDetails } from './safe-details.js'

// Central HTTP error mapper (Step 03). This is the only module, besides the Hapi plugin that calls it
// (src/plugins/error-mapping.js), permitted to import @hapi/boom — it is explicitly the HTTP boundary.
// Converts any application error, Joi/Hapi validation failure, existing Boom error, or unexpected failure
// into a safe { statusCode, payload } HTTP response. Never throws: an internal mapping failure itself
// still produces a safe 500 response.

const GENERIC_INTERNAL_MESSAGE =
  'An unexpected error occurred. Please try again later.'

const GENERIC_VALIDATION_MESSAGE = 'The request is invalid.'

// Deterministic fallback code for a Boom-shaped error that carries no application code, derived only
// from its HTTP status (never from its message). 409 is deliberately generic ("CONFLICT") because the
// approved category table maps four distinct categories to 409 and guessing which one applies to an
// error that did not originate from this service's ApplicationError contract would be a business-specific
// guess, which is explicitly disallowed.
const STATUS_FALLBACK_CODE = Object.freeze({
  400: 'INVALID_REQUEST',
  401: 'AUTHENTICATION_REQUIRED',
  403: 'ACCESS_DENIED',
  404: 'RESOURCE_NOT_FOUND',
  409: 'CONFLICT',
  422: 'BUSINESS_VALIDATION_FAILED',
  429: 'TOO_MANY_REQUESTS',
  500: 'INTERNAL_SERVER_ERROR',
  502: 'UPSTREAM_INVALID_RESPONSE',
  503: 'DEPENDENCY_UNAVAILABLE',
  504: 'UPSTREAM_TIMEOUT'
})

function buildPayload({ statusCode, code, message, correlationId, details }) {
  const payload = { statusCode, code, message }

  if (correlationId) {
    payload.correlationId = correlationId
  }

  if (details && details.length > 0) {
    payload.details = details
  }

  return payload
}

function mapApplicationError(error, correlationId) {
  const statusCode = CATEGORY_HTTP_STATUS[error.category]

  return {
    statusCode,
    payload: buildPayload({
      statusCode,
      code: error.code,
      message: error.message,
      correlationId,
      details: error.details
    })
  }
}

function mapValidationError(error, correlationId) {
  const statusCode = error.output?.statusCode ?? 400
  const safeDetails = buildSafeDetails(
    error.details.map((detail) => ({
      path: Array.isArray(detail.path)
        ? detail.path.join('.')
        : String(detail.path ?? ''),
      code: detail.type
    }))
  )

  return {
    statusCode,
    payload: buildPayload({
      statusCode,
      code: STATUS_FALLBACK_CODE[statusCode] ?? `HTTP_${statusCode}`,
      message: GENERIC_VALIDATION_MESSAGE,
      correlationId,
      details: safeDetails
    })
  }
}

function mapBoomError(error, correlationId) {
  const statusCode = error.output.statusCode
  const code =
    error.data?.code ?? STATUS_FALLBACK_CODE[statusCode] ?? `HTTP_${statusCode}`

  return {
    statusCode,
    payload: buildPayload({
      statusCode,
      code,
      // Boom's own output.payload.message is already safe: generic for every 5xx status (never the
      // original error message) and the intended public message for <5xx (e.g. Boom.notFound()).
      message: error.output.payload.message,
      correlationId
    })
  }
}

function mapUnexpectedError(correlationId) {
  return {
    statusCode: 500,
    payload: buildPayload({
      statusCode: 500,
      code: 'INTERNAL_SERVER_ERROR',
      message: GENERIC_INTERNAL_MESSAGE,
      correlationId
    })
  }
}

export function mapErrorToHttpResponse(error) {
  try {
    const correlationId = getTraceId()

    if (isApplicationError(error)) {
      return mapApplicationError(error, correlationId)
    }

    if (error?.isJoi && Array.isArray(error.details)) {
      return mapValidationError(error, correlationId)
    }

    if (Boom.isBoom(error)) {
      return mapBoomError(error, correlationId)
    }

    return mapUnexpectedError(correlationId)
  } catch {
    return mapUnexpectedError()
  }
}
