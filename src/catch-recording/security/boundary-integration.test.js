import Hapi from '@hapi/hapi'
import Boom from '@hapi/boom'

import { errorMapping } from '#/plugins/error-mapping.js'
import { failAction } from '#/common/helpers/fail-action.js'
import { createAuthenticationContext } from '#/catch-recording/controller/authentication-context.js'
import { decideReadAccess } from './resource-access-policy.js'
import { enforcePolicyOutcome } from './policy-errors.js'

const RECORDS = {
  'record-1': { ownerUserId: 'user-1' },
  'record-2': { ownerUserId: 'user-2' }
}

async function createTestServer() {
  const server = Hapi.server({
    routes: { validate: { options: { abortEarly: false }, failAction } }
  })

  await server.register(errorMapping)

  server.route([
    {
      method: 'GET',
      path: '/catch-records/{id}',
      handler: (request) => {
        const authenticationContext = createAuthenticationContext({
          actorId: request.headers['x-test-actor-id'],
          permissions: []
        })
        const record = RECORDS[request.params.id]

        enforcePolicyOutcome(
          decideReadAccess({
            authenticationContext,
            ownerUserId: record?.ownerUserId
          })
        )

        return { id: request.params.id, ...record }
      }
    },
    {
      method: 'GET',
      path: '/boom-unauthorized',
      handler: () => Boom.unauthorized('Missing token', 'Bearer')
    }
  ])

  await server.initialize()

  return server
}

describe('#security boundary integration', () => {
  let server

  afterEach(async () => {
    if (server) {
      await server.stop({ timeout: 0 })
      server = undefined
    }
  })

  test('Should compose a real Step 13 authentication context with a Step 14 policy and allow the owner', async () => {
    server = await createTestServer()

    const response = await server.inject({
      method: 'GET',
      url: '/catch-records/record-1',
      headers: { 'x-test-actor-id': 'user-1' }
    })

    expect(response.statusCode).toBe(200)
    expect(response.result).toEqual({
      id: 'record-1',
      ownerUserId: 'user-1'
    })
  })

  test('Should map a cross-owner denial to a safe 404, not a 403', async () => {
    server = await createTestServer()

    const response = await server.inject({
      method: 'GET',
      url: '/catch-records/record-2',
      headers: { 'x-test-actor-id': 'user-1' }
    })

    expect(response.statusCode).toBe(404)
    expect(response.result.code).toBe('RESOURCE_NOT_FOUND')
  })

  test('Should map an unknown record the same safe way as a cross-owner record', async () => {
    server = await createTestServer()

    const response = await server.inject({
      method: 'GET',
      url: '/catch-records/does-not-exist',
      headers: { 'x-test-actor-id': 'user-1' }
    })

    expect(response.statusCode).toBe(404)
  })

  test('Should map a missing trusted authentication context to 401', async () => {
    server = await createTestServer()

    const response = await server.inject({
      method: 'GET',
      url: '/catch-records/record-1'
    })

    expect(response.statusCode).toBe(401)
    expect(response.result.code).toBe('AUTHENTICATION_REQUIRED')
  })

  test('Should preserve existing unrelated Boom WWW-Authenticate challenge behaviour', async () => {
    server = await createTestServer()

    const response = await server.inject({
      method: 'GET',
      url: '/boom-unauthorized'
    })

    expect(response.statusCode).toBe(401)
    expect(response.headers['www-authenticate']).toBe(
      'Bearer error="Missing token"'
    )
  })
})
