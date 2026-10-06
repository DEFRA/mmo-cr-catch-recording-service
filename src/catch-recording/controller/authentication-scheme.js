import { getTraceId } from '@defra/hapi-tracing'
import { audit } from '@defra/cdp-auditing'

import { isApplicationError } from '#/common/helpers/errors/application-error.js'
import { createAuthenticationContext } from './authentication-context.js'
import { authenticationRequiredError } from './authentication-errors.js'

const BEARER_PREFIX = 'Bearer '
const AUDIT_EVENT = 'catch_recording.authentication'

/**
 * Extracts the bearer token from an `Authorization` header value. Returns `null` for anything that is
 * not an exact `Bearer <token>` string - no other header, payload, query, or path value is ever treated
 * as a source of identity.
 *
 * @param {unknown} authorizationHeader
 * @returns {string | null}
 */
export function extractBearerToken(authorizationHeader) {
  if (
    typeof authorizationHeader !== 'string' ||
    !authorizationHeader.startsWith(BEARER_PREFIX)
  ) {
    return null
  }

  const token = authorizationHeader.slice(BEARER_PREFIX.length).trim()
  return token.length > 0 ? token : null
}

function auditOutcome({ outcome, code, correlationId }) {
  audit({ event: AUDIT_EVENT, outcome, code, correlationId }, AUDIT_EVENT)
}

/**
 * Hapi custom authentication scheme. The sole trusted input is the request's `Authorization` header;
 * the caller's identity is established only by successfully validating its bearer token against the
 * Authentication Service (via the injected `authenticationClient`). Never trusts payload, query, path,
 * or any other header.
 *
 * @param {import('@hapi/hapi').Server} _server
 * @param {{ authenticationClient: { validate: Function } }} options
 */
export function authenticationServiceScheme(_server, options) {
  const { authenticationClient } = options

  return {
    authenticate: async (request, h) => {
      const correlationId = getTraceId()
      const token = extractBearerToken(request.headers.authorization)

      try {
        const actor = await authenticationClient.validate({
          token,
          correlationId
        })
        const credentials = createAuthenticationContext(actor)

        auditOutcome({ outcome: 'success', code: null, correlationId })
        return h.authenticated({ credentials })
      } catch (cause) {
        const error = isApplicationError(cause)
          ? cause
          : authenticationRequiredError(cause)
        auditOutcome({
          outcome: 'failure',
          code: error.code,
          correlationId
        })
        return h.unauthenticated(error)
      }
    }
  }
}
