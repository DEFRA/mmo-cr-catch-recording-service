import { getTraceId } from '@defra/hapi-tracing'

import { isApplicationError } from '#/common/helpers/errors/application-error.js'
import { mapErrorToResponse } from '#/common/helpers/errors/http-error-mapper.js'

// Authentication, permission and authorization-unavailability outcomes get one focused, safe log entry
const ACCESS_CATEGORIES = new Set([
  'AUTHENTICATION_FAILURE',
  'AUTHORISATION_FAILURE',
  'DEPENDENCY_UNAVAILABLE'
])

/**
 * The single, central Hapi HTTP error-mapping boundary.
 *
 * Registers one `onPreResponse` extension. Successful responses pass through unchanged. Every error
 * response (`ApplicationError`, a Joi/Hapi validation failure, an existing Boom error, or an unexpected
 * failure — Hapi always boomifies a thrown error by this point, so `response.isBoom` reliably detects
 * all of them) is mapped through the framework-neutral `mapErrorToResponse`, and only the resulting
 * safe status, payload, and headers are applied.
 */
export const errorMapping = {
  plugin: {
    name: 'error-mapping',
    // Hapi refuses a second registration of a `once: true` plugin, structurally guaranteeing exactly
    // one central error-mapping boundary rather than relying on review alone.
    once: true,
    register: (server, _options) => {
      server.ext('onPreResponse', (request, h) => {
        const response = request.response

        if (!response?.isBoom) {
          return h.continue
        }

        const correlationId = getTraceId()
        const { statusCode, payload, headers } = mapErrorToResponse(
          response,
          correlationId
        )

        if (
          isApplicationError(response) &&
          ACCESS_CATEGORIES.has(response.category) &&
          // Authorization outcomes always carry a bounded reason; other 503s (e.g. reference data) do not
          (response.category !== 'DEPENDENCY_UNAVAILABLE' ||
            response.meta?.reason)
        ) {
          // Only bounded categories: never the token, claims, identifier, roles or the internal cause.
          // Expected 401/403 are informational; an unavailable authorization source is a warning.
          const sink = server.securityTelemetry ?? request.logger
          const level =
            response.category === 'DEPENDENCY_UNAVAILABLE' ? 'warn' : 'info'
          sink?.[level]?.(
            {
              event: 'access-response',
              category: response.category,
              statusCode,
              reason: response.meta?.reason,
              correlationId
            },
            'access response emitted'
          )
        }

        const mapped = h.response(payload).code(statusCode)

        for (const [name, value] of Object.entries(headers ?? {})) {
          mapped.header(name, value)
        }

        return mapped
      })
    }
  }
}
