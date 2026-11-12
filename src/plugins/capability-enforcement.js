import { getTraceId } from '@defra/hapi-tracing'

import { getAuthenticatedUser } from '#/authentication/entra/authenticated-user-context.js'
import { ENTRA_AUTH_STRATEGY } from '#/authentication/entra/entra-auth-strategy.js'
import {
  authorizationDecisionError,
  authorizerUnavailableError,
  missingMappingError
} from '#/authorization/authorization-errors.js'
import { AuthorizationOutcome } from '#/authorization/capability-authorizer.js'
import { readRouteAuthorization } from '#/authorization/protected-route.js'

const PLUGIN_NAME = 'capability-enforcement'

// An unmapped protected route is a configuration defect: always a warning with no route or user detail
function reportMissingMapping(server) {
  server.securityTelemetry?.warn(
    {
      event: 'authorization.missing-mapping',
      outcome: 'failure',
      reason: 'missing-capability-mapping',
      correlationId: getTraceId()
    },
    'authorization.missing-mapping'
  )
}

const isProtected = (route) => Boolean(route.settings.auth)

function describeInvalidRoutes(server) {
  return server
    .table()
    .filter((route) => isProtected(route))
    .filter((route) => {
      const { capability, vesselIdParam } = readRouteAuthorization(route)
      const strategies = route.settings.auth.strategies ?? []

      return (
        !capability ||
        strategies.length !== 1 ||
        strategies[0] !== ENTRA_AUTH_STRATEGY ||
        (vesselIdParam !== undefined &&
          !route.path.includes(`{${vesselIdParam}}`))
      )
    })
    .map((route) => `${route.method.toUpperCase()} ${route.path}`)
}

/**
 * The retrieved decision of the capability check made for this request (available to later authorization
 * stages, e.g. the vessels the capability was granted for), or `null` when none was made.
 *
 * @param {import('@hapi/hapi').Request} request
 */
export function getCapabilityDecision(request) {
  return request.plugins[PLUGIN_NAME]?.decision ?? null
}

/**
 * The single capability-enforcement boundary. Runs after authentication and before payload validation and
 * the handler, for every authenticated route, so a denied or unavailable decision stops the request before
 * any protected side effect:
 *
 * - the capability comes only from the route's own metadata (`protectedRoute`); a protected route without a
 *   catalogue capability fails closed per request and prevents the server from starting;
 * - the caller is only the trusted authenticated-user context, never request data;
 * - public routes (no authentication configured) are untouched.
 *
 * Requires the `capabilityAuthorizer` plugin. Resource and domain rules remain in the handlers and are
 * composed by Step 11; HTTP error shaping is finalised in Step 12.
 */
export const capabilityEnforcement = {
  plugin: {
    name: PLUGIN_NAME,
    once: true,
    dependencies: ['capability-authorizer', 'entra-authentication'],
    register: (server) => {
      server.ext('onPreStart', () => {
        const invalid = describeInvalidRoutes(server)
        if (invalid.length > 0) {
          throw new Error(
            `Protected routes without a valid capability mapping: ${invalid.join(', ')}`
          )
        }
      })

      server.ext('onPostAuth', async (request, h) => {
        if (!isProtected(request.route)) {
          return h.continue
        }

        const { capability, vesselIdParam } = readRouteAuthorization(request)
        if (!capability) {
          reportMissingMapping(server)
          throw missingMappingError()
        }

        const vesselId = vesselIdParam
          ? request.params[vesselIdParam]
          : undefined
        if (vesselIdParam && typeof vesselId !== 'string') {
          reportMissingMapping(server)
          throw missingMappingError()
        }

        if (!server.capabilityAuthorizer) {
          throw authorizerUnavailableError()
        }

        const decision = await server.capabilityAuthorizer.authorize(
          getAuthenticatedUser(request),
          capability,
          { vesselId, correlationId: getTraceId() }
        )
        if (decision.outcome !== AuthorizationOutcome.ALLOWED) {
          throw authorizationDecisionError(decision)
        }

        request.plugins[PLUGIN_NAME] = { decision }
        return h.continue
      })
    }
  }
}
