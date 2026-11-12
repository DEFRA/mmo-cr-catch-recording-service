import { createRoleDefinitionsCache } from '#/authorization/role-definitions-cache.js'

/**
 * Decorates the server with `roleDefinitionsCache`: the single shared role-to-capability snapshot cache
 * for the configured service (`null` when authorization is unconfigured in local development).
 *
 * Startup policy: once the server has started, one best-effort initial load is attempted through the very
 * same refresh operation used for lazy loading. It is not awaited and its failure never prevents startup:
 * with no usable snapshot, authorization simply stays unavailable (fail closed) until a load succeeds.
 * Nothing is published unless it passes validation. The cache is cleared when the server stops, and is not
 * yet used by any request path.
 */
export const roleDefinitionsCache = {
  plugin: {
    name: 'role-definitions-cache',
    once: true,
    dependencies: ['user-profile-client'],
    register: (server, options) => {
      const cache = server.userProfileClient
        ? createRoleDefinitionsCache({
            ...options,
            userProfileClient: server.userProfileClient,
            logger: server.securityTelemetry ?? server.logger
          })
        : null

      server.decorate('server', 'roleDefinitionsCache', cache)
      server.ext('onPostStart', () => {
        cache?.getRoleDefinitions()
      })
      server.events.on('stop', () => cache?.clear())
    }
  }
}
