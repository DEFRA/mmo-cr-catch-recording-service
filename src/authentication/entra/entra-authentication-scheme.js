import { authenticationRequiredError } from '#/catch-recording/controller/authentication-errors.js'

/**
 * Hapi custom authentication scheme backed by the Entra access-token validator. The only trusted input
 * is the standard `Authorization` header; it is validated once per request, and a failure stops the
 * request with the existing controlled authentication failure.
 *
 * Step 03 establishes token validation only. A successful validation authenticates the request with an
 * empty credentials object: no claim is propagated and no user identity exists until the trusted
 * authenticated-user context is added (Step 04). The failure reason is kept as the internal `cause` for
 * logs and is never serialised publicly; mapping key-dependency failures to `503` is Step 12.
 *
 * @param {import('@hapi/hapi').Server} _server
 * @param {{ validator: { validate: Function } }} options
 */
export function entraAuthenticationScheme(_server, options) {
  const { validator } = options

  return {
    authenticate: async (request, h) => {
      const result = await validator.validate(request.headers.authorization)

      if (!result.ok) {
        return h.unauthenticated(
          authenticationRequiredError(
            new Error(`Entra token validation failed: ${result.reason}`)
          )
        )
      }

      return h.authenticated({ credentials: Object.freeze({}) })
    }
  }
}
