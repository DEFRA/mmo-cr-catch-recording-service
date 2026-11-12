import { createUserRoleCache } from '#/authorization/user-role-cache.js'

/**
 * Decorates the server with `userRoleCache`: one shared, bounded, process-local user-role cache built on
 * the shared User Profile Service client (`null` when authorization is unconfigured in local
 * development). It is cleared when the server stops and is not yet used by any request path.
 */
export const userRoleCache = {
  plugin: {
    name: 'user-role-cache',
    once: true,
    dependencies: ['user-profile-client'],
    register: (server, options) => {
      const cache = server.userProfileClient
        ? createUserRoleCache({
            ...options,
            userProfileClient: server.userProfileClient,
            logger: server.logger
          })
        : null

      server.decorate('server', 'userRoleCache', cache)
      server.events.on('stop', () => cache?.clear())
    }
  }
}
