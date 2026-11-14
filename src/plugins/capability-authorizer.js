import { createCapabilityAuthorizer } from '#/authorization/capability-authorizer.js'

/**
 * Decorates the server with `capabilityAuthorizer`: the single stateless capability-authorization engine
 * over the shared user-role and role-definition caches (`null` when authorization is unconfigured in local
 * development). It is not yet applied to any endpoint.
 */
export const capabilityAuthorizer = {
  plugin: {
    name: 'capability-authorizer',
    once: true,
    dependencies: ['user-role-cache', 'role-definitions-cache'],
    register: (server) => {
      const authorizer =
        server.userRoleCache && server.roleDefinitionsCache
          ? createCapabilityAuthorizer({
              userRoleCache: server.userRoleCache,
              roleDefinitionsCache: server.roleDefinitionsCache,
              logger: server.securityTelemetry ?? server.logger
            })
          : null

      server.decorate('server', 'capabilityAuthorizer', authorizer)
    }
  }
}
