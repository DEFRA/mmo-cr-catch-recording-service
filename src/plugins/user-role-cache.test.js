import Hapi from '@hapi/hapi'

import { userProfile } from './user-profile-client.js'
import { userRoleCache } from './user-role-cache.js'

const profileOptions = {
  userRolesUrlTemplate:
    'https://user-profile.test.invalid/users/{entraObjectId}/roles',
  roleDefinitionsUrl:
    'https://user-profile.test.invalid/roles-definitions/services/catch-recording',
  userProfileRequestTimeoutMs: 1000
}
const cacheOptions = { ttlSeconds: 300, maximumEntries: 10 }

const createServer = async (profile) => {
  const server = Hapi.server()
  server.logger = { debug: () => {}, warn: () => {} }
  await server.register([
    { plugin: userProfile, options: profile },
    { plugin: userRoleCache, options: cacheOptions }
  ])
  return server
}

describe('#userRoleCache', () => {
  test('Should decorate the server with one shared cache and make no request at registration', async () => {
    const fetchFn = vi.fn()

    const server = await createServer({ ...profileOptions, fetchFn })

    expect(server.userRoleCache.getUserRoles).toBeInstanceOf(Function)
    expect(fetchFn).not.toHaveBeenCalled()
  })

  test('Should decorate the server with null when authorization is not configured', async () => {
    const server = await createServer({
      ...profileOptions,
      userRolesUrlTemplate: null,
      roleDefinitionsUrl: null
    })

    expect(server.userRoleCache).toBeNull()
    await server.initialize()
    await server.stop({ timeout: 0 })
  })

  test('Should release the cache when the server stops', async () => {
    const server = await createServer(profileOptions)
    const clear = vi.spyOn(server.userRoleCache, 'clear')

    await server.initialize()
    await server.stop({ timeout: 0 })

    expect(clear).toHaveBeenCalledTimes(1)
  })
})
