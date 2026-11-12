import Hapi from '@hapi/hapi'

import { userProfile } from './user-profile-client.js'

const options = {
  userRolesUrlTemplate:
    'https://user-profile.test.invalid/users/{entraObjectId}/roles',
  roleDefinitionsUrl:
    'https://user-profile.test.invalid/roles-definitions/services/catch-recording',
  userProfileRequestTimeoutMs: 1000,
  userProfileRetryCount: 1,
  userProfileRetryDelayMs: 10
}

const register = async (pluginOptions) => {
  const server = Hapi.server()
  server.logger = { debug: () => {}, warn: () => {} }
  await server.register({ plugin: userProfile, options: pluginOptions })
  return server
}

describe('#userProfile', () => {
  test('Should decorate the server with one shared client and make no request at registration', async () => {
    const fetchFn = vi.fn()

    const server = await register({ ...options, fetchFn })

    expect(server.userProfileClient.getUserRoles).toBeInstanceOf(Function)
    expect(server.userProfileClient.getRoleDefinitions).toBeInstanceOf(Function)
    expect(fetchFn).not.toHaveBeenCalled()
  })

  test('Should decorate the server with null when authorization is not configured', async () => {
    const server = await register({
      ...options,
      userRolesUrlTemplate: null,
      roleDefinitionsUrl: null
    })

    expect(server.userProfileClient).toBeNull()
  })
})
