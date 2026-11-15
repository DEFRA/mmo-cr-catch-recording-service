import Hapi from '@hapi/hapi'

import { capabilityAuthorizer } from './capability-authorizer.js'
import { roleDefinitionsCache } from './role-definitions-cache.js'
import { userProfile } from './user-profile-client.js'
import { userRoleCache } from './user-role-cache.js'

const profileOptions = {
  userRolesUrlTemplate:
    'https://user-profile.test.invalid/users/{entraObjectId}/roles',
  roleDefinitionsUrl:
    'https://user-profile.test.invalid/roles-definitions/services/catch-recording',
  userProfileRequestTimeoutMs: 1000
}

const createServer = async (profile) => {
  const server = Hapi.server()
  server.logger = { debug: () => {}, warn: () => {} }
  await server.register([
    { plugin: userProfile, options: profile },
    { plugin: userRoleCache, options: { ttlSeconds: 300, maximumEntries: 10 } },
    {
      plugin: roleDefinitionsCache,
      options: {
        serviceId: 'catch-recording',
        ttlSeconds: 60,
        maximumStaleSeconds: 300
      }
    },
    { plugin: capabilityAuthorizer }
  ])
  return server
}

describe('#capabilityAuthorizer', () => {
  test('Should decorate the server with one shared authorizer and make no request at registration', async () => {
    const fetchFn = vi.fn()

    const server = await createServer({ ...profileOptions, fetchFn })

    expect(server.capabilityAuthorizer.authorize).toBeInstanceOf(Function)
    expect(fetchFn).not.toHaveBeenCalled()
  })

  test('Should decorate the server with null when authorization is not configured', async () => {
    const server = await createServer({
      ...profileOptions,
      userRolesUrlTemplate: null,
      roleDefinitionsUrl: null
    })

    expect(server.capabilityAuthorizer).toBeNull()
  })
})
