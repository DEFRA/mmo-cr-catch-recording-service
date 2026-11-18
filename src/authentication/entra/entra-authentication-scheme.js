import { safeLog } from '#/common/helpers/logging/safe-log.js'
import { getTraceId } from '@defra/hapi-tracing'

import { tokenFailureCategory } from '#/authorization/security-telemetry.js'
import { entraAuthenticationError } from './authentication-error.js'
import { createAuthenticatedUserContext } from './authenticated-user-context.js'

const TOKEN_VALIDATION_EVENT = 'auth.token-validation'

/**
 * Hapi custom authentication scheme backed by the Entra access-token validator. The only trusted input
 * is the standard `Authorization` header. The request pipeline is: validate the token completely, then
 * extract the single configured stable identity claim, then expose the minimal authenticated-user context
 * as the request's credentials (read it with `getAuthenticatedUser`). A failure at either stage stops the
 * request with the generic authentication failure; no context exists for a failed request and nothing
 * falls back to another identity.
 *
 * Every outcome is reported once to the optional security-telemetry sink as a bounded category plus its
 * latency - never the token, header, claims, identifier or signing-key detail. Telemetry cannot change
 * the authentication result.
 *
 * @param {import('@hapi/hapi').Server} _server
 * @param {{ validator: { validate: Function }, userIdClaim: string | null,
 *   telemetry?: { info: Function, warn: Function, debug: Function }, now?: () => number }} options
 */
export function entraAuthenticationScheme(_server, options) {
  const {
    validator,
    userIdClaim,
    telemetry,
    now = () => performance.now()
  } = options

  const report = (startedAt, outcome, reason, source, detail = reason) => {
    try {
      const durationMs = now() - startedAt
      const message = `Authentication ${outcome}: ${detail} (${Math.round(durationMs)}ms)`
      const fields = {
        event: TOKEN_VALIDATION_EVENT,
        outcome,
        reason,
        correlationId: getTraceId(),
        durationMs
      }
      if (outcome === 'success') {
        telemetry?.debug(fields, message)
      } else if (source === 'dependency' || source === 'internal') {
        telemetry?.warn(fields, message)
      } else {
        // Expected credential failures are not errors and are logged below warning to limit flooding
        telemetry?.info(fields, message)
      }
    } catch {
      // telemetry is never allowed to alter the authentication outcome
    }
  }

  const reject = (h, startedAt, reason, source) => {
    report(
      startedAt,
      'failure',
      tokenFailureCategory(reason),
      source,
      reason.toLowerCase().replaceAll('_', '-')
    )
    return h.unauthenticated(entraAuthenticationError(reason))
  }

  return {
    authenticate: async (request, h) => {
      const startedAt = now()
      safeLog(
        telemetry,
        'debug',
        { event: TOKEN_VALIDATION_EVENT, correlationId: getTraceId() },
        'Authentication flow started'
      )
      const validation = await validator.validate(request.headers.authorization)
      if (!validation.ok) {
        return reject(h, startedAt, validation.reason, validation.source)
      }

      const identity = createAuthenticatedUserContext(
        validation.claims,
        userIdClaim
      )
      if (!identity.ok) {
        report(startedAt, 'failure', 'identity-claim', 'credentials')
        return h.unauthenticated(entraAuthenticationError(identity.reason))
      }

      report(startedAt, 'success', 'authenticated', 'credentials')
      return h.authenticated({ credentials: identity.user })
    }
  }
}
