import Hapi from '@hapi/hapi'

import { registerStubAuthorization } from '#/authorization/authorization-test-fixtures.js'
import {
  AuthorizationOutcome,
  DenialReason,
  UnavailableReason
} from '#/authorization/capability-authorizer.js'
import { errorMapping } from '#/plugins/error-mapping.js'
import { requestTracing } from '#/plugins/request-tracing.js'
import { failAction } from '#/common/helpers/fail-action.js'
import { catchRecords } from './catch-records.js'
import { vesselProfiles } from './vessel-profiles.js'

const BEARER = { authorization: 'Bearer token-1' }
const WRITE_METHODS = [
  'insertOne',
  'updateOne',
  'findOneAndUpdate',
  'deleteOne',
  'replaceOne',
  'bulkWrite'
]

/** A database double that records every collection access and every write, and holds no records. */
function createRecordingDb() {
  const writes = []
  const collections = []
  const collection = (name) => {
    collections.push(name)
    return Object.fromEntries([
      ['findOne', vi.fn(async () => null)],
      [
        'find',
        vi.fn(() => ({
          toArray: async () => [],
          sort() {
            return this
          },
          limit() {
            return this
          },
          project() {
            return this
          }
        }))
      ],
      ...WRITE_METHODS.map((method) => [
        method,
        vi.fn(async () => {
          writes.push(`${name}.${method}`)
          return {
            acknowledged: true,
            matchedCount: 0,
            modifiedCount: 0,
            deletedCount: 0
          }
        })
      ])
    ])
  }

  return { db: { collection }, writes, collections }
}

async function createServer({ authorize }) {
  const server = Hapi.server({
    routes: { validate: { options: { abortEarly: false }, failAction } }
  })
  await server.register([requestTracing, errorMapping])
  const stub = await registerStubAuthorization(server, { authorize })

  const recording = createRecordingDb()
  const referenceDataClient = {
    getVessel: vi.fn(),
    listVessels: vi.fn()
  }
  server.decorate('request', 'db', () => recording.db, { apply: true })
  server.decorate('request', 'referenceDataClient', () => referenceDataClient, {
    apply: true
  })
  server.decorate(
    'request',
    'catchArtifactStore',
    () => ({ retrieveArtifact: vi.fn() }),
    { apply: true }
  )
  server.route([...catchRecords, ...vesselProfiles])

  return { server, ...stub, ...recording, referenceDataClient }
}

const PROTECTED_REQUESTS = [
  ['GET', '/v1/catch-records', undefined, {}],
  ['POST', '/v1/catch-records', { vesselId: 'vessel-1' }, {}],
  ['GET', '/v1/catch-records/r-1', undefined, {}],
  ['PUT', '/v1/catch-records/r-1', { not: 'valid' }, { 'if-match': '1' }],
  ['PATCH', '/v1/catch-records/r-1', { not: 'valid' }, { 'if-match': '1' }],
  ['DELETE', '/v1/catch-records/r-1', undefined, { 'if-match': '1' }],
  ['GET', '/v1/catch-records/r-1/history', undefined, {}],
  ['POST', '/v1/catch-records/r-1/submission', undefined, { 'if-match': '1' }],
  ['GET', '/v1/catch-records/r-1/submissions', undefined, {}],
  ['GET', '/v1/catch-records/r-1/submissions/1/json', undefined, {}],
  ['POST', '/v1/catch-records/r-1/edit-start', undefined, { 'if-match': '1' }],
  ['GET', '/v1/vessels/vessel-1/favourite-gears', undefined, {}],
  ['POST', '/v1/vessels/vessel-1/skippers', { name: 'Jane Doe' }, {}],
  ['DELETE', '/v1/vessels/vessel-1/skippers/s-1', undefined, {}]
]

const call = (server, [method, url, payload, headers]) =>
  server.inject({ method, url, payload, headers: { ...BEARER, ...headers } })

describe('authorization composition: capability is evaluated first and gates everything', () => {
  test.each([
    [
      'capability denied',
      {
        outcome: AuthorizationOutcome.DENIED,
        reason: DenialReason.NO_ASSIGNED_ROLES
      },
      403
    ],
    [
      'authorization data unavailable',
      {
        outcome: AuthorizationOutcome.UNAVAILABLE,
        reason: UnavailableReason.ROLE_DEFINITIONS_OVER_STALE
      },
      503
    ],
    [
      'an internal failure',
      {
        outcome: AuthorizationOutcome.UNAVAILABLE,
        reason: UnavailableReason.INTERNAL_FAILURE
      },
      500
    ]
  ])(
    'Should stop every protected route with %s before any database, reference-data or write access',
    async (_name, decision, status) => {
      const { server, writes, collections, referenceDataClient } =
        await createServer({
          authorize: async () => decision
        })
      await server.initialize()

      for (const request of PROTECTED_REQUESTS) {
        const response = await call(server, request)
        expect([request[0], request[1], response.statusCode]).toEqual([
          request[0],
          request[1],
          status
        ])
      }

      expect(collections).toEqual([])
      expect(writes).toEqual([])
      expect(referenceDataClient.getVessel).not.toHaveBeenCalled()
      expect(referenceDataClient.listVessels).not.toHaveBeenCalled()
    }
  )

  test('Should evaluate the capability exactly once per request, ahead of the resource lookup', async () => {
    const order = []
    const { server } = await createServer({
      authorize: async () => {
        order.push('capability')
        return { outcome: AuthorizationOutcome.ALLOWED, grantedVesselIds: [] }
      }
    })
    await server.initialize()

    const response = await call(server, PROTECTED_REQUESTS[2])

    expect(order).toEqual(['capability'])
    expect(response.statusCode).toBe(404)
  })

  test('Should never let an allowed capability bypass resource access: no record for the owner is a masked 404 with no write', async () => {
    const { server, writes } = await createServer({
      authorize: async () => ({
        outcome: AuthorizationOutcome.ALLOWED,
        grantedVesselIds: ['vessel-1']
      })
    })
    await server.initialize()

    const requests = PROTECTED_REQUESTS.filter(
      ([method, url]) =>
        (method === 'GET' && /^\/v1\/catch-records\/r-1/.test(url)) ||
        (method === 'POST' && /submission$|edit-start$/.test(url))
    )
    const statuses = []
    for (const request of requests) {
      statuses.push((await call(server, request)).statusCode)
    }

    expect(statuses.every((status) => status === 404)).toBe(true)
    expect(writes).toEqual([])
  })

  test('Should reject input that fails validation only after the capability was granted', async () => {
    const { server, authorize } = await createServer({
      authorize: async () => ({
        outcome: AuthorizationOutcome.ALLOWED,
        grantedVesselIds: []
      })
    })
    await server.initialize()

    const response = await call(server, PROTECTED_REQUESTS[3])

    expect(response.statusCode).toBe(400)
    expect(authorize).toHaveBeenCalledTimes(1)
  })

  test('Should not reach capability, resource or domain layers for a failed authentication', async () => {
    const { server, authorize, collections } = await createServer({
      authorize: async () => ({
        outcome: AuthorizationOutcome.ALLOWED,
        grantedVesselIds: []
      })
    })
    await server.initialize()

    for (const request of PROTECTED_REQUESTS) {
      const response = await server.inject({
        method: request[0],
        url: request[1],
        payload: request[2],
        headers: { ...request[3], authorization: 'Bearer read-token' }
      })
      expect(response.statusCode).toBe(401)
    }

    expect(authorize).not.toHaveBeenCalled()
    expect(collections).toEqual([])
  })

  test('Should not let ownership or other resource access replace the capability', async () => {
    const { server, authorize, collections } = await createServer({
      authorize: async () => ({
        outcome: AuthorizationOutcome.DENIED,
        reason: DenialReason.CAPABILITY_NOT_GRANTED
      })
    })
    await server.initialize()

    const response = await call(server, PROTECTED_REQUESTS[7])

    expect(response.statusCode).toBe(403)
    expect(authorize.mock.calls[0][1].capabilityId).toBe('catch-record.submit')
    expect(collections).toEqual([])
  })
})
