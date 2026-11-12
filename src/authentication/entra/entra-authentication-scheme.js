import { entraAuthenticationError } from './authentication-error.js'
import { createAuthenticatedUserContext } from './authenticated-user-context.js'

/**
 * Hapi custom authentication scheme backed by the Entra access-token validator. The only trusted input
 * is the standard `Authorization` header. The request pipeline is: validate the token completely, then
 * extract the single configured stable identity claim, then expose the minimal authenticated-user context
 * as the request's credentials (read it with `getAuthenticatedUser`). A failure at either stage stops the
 * request with the existing generic authentication failure; no context exists for a failed request and
 * nothing falls back to another identity.
 *
 * The failure reason is kept as the internal `cause` only and is never serialised publicly; mapping
 * key-dependency failures to `503` is Step 12.
 *
 * @param {import('@hapi/hapi').Server} _server
 * @param {{ validator: { validate: Function }, userIdClaim: string | null }} options
 */
export function entraAuthenticationScheme(_server, options) {
  const { validator, userIdClaim } = options

  const reject = (h, reason) =>
    h.unauthenticated(entraAuthenticationError(reason))

  return {
    authenticate: async (request, h) => {
      const validation = await validator.validate(request.headers.authorization)
      if (!validation.ok) {
        return reject(h, validation.reason)
      }

      const identity = createAuthenticatedUserContext(
        validation.claims,
        userIdClaim
      )
      if (!identity.ok) {
        return reject(h, identity.reason)
      }

      return h.authenticated({ credentials: identity.user })
    }
  }
}
