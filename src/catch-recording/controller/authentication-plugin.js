import { createAuthenticationClient } from './authentication-client.js'
import { authenticationServiceScheme } from './authentication-scheme.js'

const STRATEGY_NAME = 'authentication-service'

/**
 * Registers the trusted-identity Hapi authentication scheme and strategy. Dormant by itself - no route
 * in this step sets `options: { auth: 'authentication-service' }`. A later step opts a route in once its
 * authorisation policy (Step 14) is ready to consume the resulting `request.auth.credentials`.
 */
export const authenticationPlugin = {
  plugin: {
    name: 'authentication',
    once: true,
    register: (server, options) => {
      const authenticationClient = createAuthenticationClient(options)

      server.auth.scheme(STRATEGY_NAME, authenticationServiceScheme)
      server.auth.strategy(STRATEGY_NAME, STRATEGY_NAME, {
        authenticationClient
      })
    }
  }
}
