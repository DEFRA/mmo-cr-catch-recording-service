import Hapi from '@hapi/hapi'

import { roleDefinitionsCache } from './role-definitions-cache.js'
import { userProfile } from './user-profile-client.js'

const profileOptions = {
  userRolesUrlTemplate:
    'https://user-profile.test.invalid/users/{entraObjectId}/roles',
  roleDefinitionsUrl:
    'https://user-profile.test.invalid/roles-definitions/services/catch-recording',
  userProfileRequestTimeoutMs: 1000,
  userProfileRetryCount: 0
}
const cacheOptions = {
  serviceId: 'catch-recording',
  ttlSeconds: 60,
  maximumStaleSeconds: 300
}
const validResponse = () =>
  new Response(
    JSON.stringify({
      schemaVersion: '1.0',
      definitionsVersion: '1',
      serviceId: 'catch-recording',
      roles: [{ roleId: 'Owner', capabilityIds: ['catch-record.read'] }]
    }),
    { status: 200, headers: { 'content-type': 'application/json' } }
  )

const createServer = async (profile) => {
  const server = Hapi.server({ port: 0 })
  server.logger = { debug: () => {}, warn: () => {} }
  await server.register([
    { plugin: userProfile, options: profile },
    { plugin: roleDefinitionsCache, options: cacheOptions }
  ])
  return server
}

describe('#roleDefinitionsCache', () => {
  test('Should make no request at registration or initialisation, only after start', async () => {
    const fetchFn = vi.fn(async () => validResponse())
    const server = await createServer({ ...profileOptions, fetchFn })

    await server.initialize()
    expect(fetchFn).not.toHaveBeenCalled()
    await server.start()
    await vi.waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(1))
    await vi.waitFor(() =>
      expect(server.roleDefinitionsCache.getStatus().state).toBe('fresh')
    )
    await server.stop({ timeout: 0 })
  })

  test('Should still start, leaving authorization unavailable, when the initial load fails', async () => {
    const fetchFn = vi.fn(async () => new Response('{}', { status: 500 }))
    const server = await createServer({ ...profileOptions, fetchFn })

    await server.start()
    await vi.waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(1))

    expect(server.roleDefinitionsCache.getStatus().state).toBe('absent')
    await server.stop({ timeout: 0 })
  })

  test('Should decorate the server with null when authorization is not configured', async () => {
    const server = await createServer({
      ...profileOptions,
      userRolesUrlTemplate: null,
      roleDefinitionsUrl: null
    })

    await server.start()

    expect(server.roleDefinitionsCache).toBeNull()
    await server.stop({ timeout: 0 })
  })

  test('Should release the snapshot when the server stops', async () => {
    const server = await createServer(profileOptions)
    const clear = vi.spyOn(server.roleDefinitionsCache, 'clear')

    await server.initialize()
    await server.stop({ timeout: 0 })

    expect(clear).toHaveBeenCalledTimes(1)
  })
})
