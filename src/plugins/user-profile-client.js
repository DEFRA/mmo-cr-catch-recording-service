import { createUserProfileClient } from '#/authorization/user-profile-client.js'

/**
 * Builds the single shared User Profile Service client from validated configuration. Returns `null` when
 * the (local-development only) configuration is entirely unset, so no authorisation data can be read.
 */
export function createConfiguredUserProfileClient(options) {
  if (!options.userRolesUrlTemplate || !options.roleDefinitionsUrl) {
    return null
  }

  return createUserProfileClient(options)
}

/**
 * Decorates the server with `userProfileClient`: one shared, stateless transport client (built once from
 * `config.get('authorization')` plus the tracing header). It is not yet used by any request path.
 */
export const userProfile = {
  plugin: {
    name: 'user-profile-client',
    once: true,
    register: (server, options) => {
      server.decorate(
        'server',
        'userProfileClient',
        createConfiguredUserProfileClient({
          ...options,
          logger: server.securityTelemetry ?? server.logger
        })
      )
    }
  }
}
