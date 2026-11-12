/* global fetchMock */
import Hapi from '@hapi/hapi'

import { vesselProfiles } from './vessel-profiles.js'
import { registerStubAuthorization } from '#/authorization/authorization-test-fixtures.js'
import { referenceDataPlugin } from '#/catch-recording/controller/reference-data-plugin.js'
import { errorMapping } from '#/plugins/error-mapping.js'
import { requestTracing } from '#/plugins/request-tracing.js'
import { failAction } from '#/common/helpers/fail-action.js'

vi.mock('@defra/cdp-auditing', () => ({ audit: vi.fn() }))

const REFERENCE_DATA_OPTIONS = {
  baseUrl: 'https://reference-data-service.example',
  serviceToken: 'service-token',
  timeoutMs: 1000,
  retryCount: 0,
  retryDelayMs: 0,
  tracingHeader: 'x-cdp-request-id'
}

function matchesFilter(document, filter) {
  return Object.entries(filter).every(([key, value]) => {
    if (key === '_id') {
      return document._id === value
    }
    if (value && typeof value === 'object' && '$ne' in value) {
      return !(document.skippers ?? []).some(
        (skipper) => skipper.normalisedName === value.$ne
      )
    }
    return document[key] === value
  })
}

function applyArrayOperators(document, update) {
  if (update.$addToSet) {
    for (const [field, value] of Object.entries(update.$addToSet)) {
      document[field] = document[field] ?? []
      if (!document[field].includes(value)) {
        document[field].push(value)
      }
    }
  }
  if (update.$push) {
    for (const [field, value] of Object.entries(update.$push)) {
      document[field] = document[field] ?? []
      document[field].push(value)
    }
  }
  if (update.$pull) {
    for (const [field, condition] of Object.entries(update.$pull)) {
      document[field] = document[field] ?? []
      if (condition && typeof condition === 'object') {
        document[field] = document[field].filter(
          (item) =>
            !Object.entries(condition).every(
              ([key, value]) => item[key] === value
            )
        )
      } else {
        document[field] = document[field].filter((item) => item !== condition)
      }
    }
  }
  if (update.$set) {
    Object.assign(document, update.$set)
  }
}

function buildFakeVesselProfileCollection() {
  const store = new Map()
  return {
    findOne: vi.fn(async (filter) => {
      const existing = store.get(filter._id)
      return existing ? structuredClone(existing) : null
    }),
    findOneAndUpdate: vi.fn(async (filter, update, options = {}) => {
      const existing = store.get(filter._id)

      if (existing && !matchesFilter(existing, filter)) {
        if (options.upsert) {
          const error = new Error('E11000 duplicate key error')
          error.code = 11000
          throw error
        }
        return null
      }

      if (!existing && !options.upsert) {
        return null
      }

      const document = existing ?? {
        _id: filter._id,
        ...(update.$setOnInsert ?? {})
      }

      applyArrayOperators(document, update)
      store.set(document._id, document)
      return structuredClone(document)
    })
  }
}

function buildIdempotencyCollection() {
  const store = new Map()
  return {
    insertOne: vi.fn(async (document) => {
      const key = `${document.ownerUserId}|${document.operationScope}|${document.idempotencyKey}|${document.resourceId}`
      if (store.has(key)) {
        const error = new Error('E11000 duplicate key error')
        error.code = 11000
        throw error
      }
      store.set(key, { ...document })
      return { acknowledged: true }
    }),
    findOne: vi.fn(async (filter) => {
      const key = `${filter.ownerUserId}|${filter.operationScope}|${filter.idempotencyKey}|${filter.resourceId}`
      const found = store.get(key)
      return found ? { ...found } : null
    }),
    findOneAndUpdate: vi.fn(async (filter, update) => {
      const key = `${filter.ownerUserId}|${filter.operationScope}|${filter.idempotencyKey}|${filter.resourceId}`
      const existing = store.get(key)
      if (!existing || existing.fingerprint !== filter.fingerprint) {
        return null
      }
      const updated = { ...existing, ...update.$set }
      store.set(key, updated)
      return { ...updated }
    })
  }
}

function fakeDb() {
  const collections = {
    'vessel-profiles': buildFakeVesselProfileCollection(),
    'catch-idempotency-claims': buildIdempotencyCollection()
  }
  return { collection: (name) => collections[name], collections }
}

async function createTestServer() {
  const server = Hapi.server({
    routes: { validate: { options: { abortEarly: false }, failAction } }
  })

  await server.register(requestTracing)
  await server.register(errorMapping)
  await registerStubAuthorization(server)
  await server.register({
    plugin: referenceDataPlugin,
    options: REFERENCE_DATA_OPTIONS
  })

  const db = fakeDb()
  server.decorate('request', 'db', () => db, { apply: true })

  server.route(vesselProfiles)

  return { server, db }
}

function mockVesselAccess({ accessibleVesselIds = ['vessel-1'] } = {}) {
  fetchMock.mockResponseOnce(
    JSON.stringify({ items: accessibleVesselIds.map((id) => ({ id })) })
  )
}

function validPortResponse() {
  return {
    id: 'port-1',
    code: 'GRK',
    name: 'Grimsby',
    countryCode: 'GB',
    coordinate: null,
    active: true
  }
}

describe('vessel favourites routes', () => {
  test('GET favourite-ports returns an empty list when no profile exists', async () => {
    const { server } = await createTestServer()
    mockVesselAccess()

    const response = await server.inject({
      method: 'GET',
      url: '/v1/vessels/vessel-1/favourite-ports',
      headers: { authorization: 'Bearer test-actor-token' }
    })

    expect(response.statusCode).toBe(200)
    expect(JSON.parse(response.payload)).toEqual({
      vesselId: 'vessel-1',
      favouritePortIds: []
    })
  })

  test('POST favourite-ports validates the reference and persists it', async () => {
    const { server } = await createTestServer()
    mockVesselAccess()
    fetchMock.mockResponseOnce(JSON.stringify(validPortResponse()))

    const response = await server.inject({
      method: 'POST',
      url: '/v1/vessels/vessel-1/favourite-ports',
      headers: { authorization: 'Bearer test-actor-token' },
      payload: { portId: 'port-1' }
    })

    expect(response.statusCode).toBe(200)
    expect(JSON.parse(response.payload)).toEqual({
      vesselId: 'vessel-1',
      favouritePortIds: ['port-1']
    })
  })

  test('POST favourite-ports rejects an unknown payload property with a safe 400', async () => {
    const { server } = await createTestServer()

    const response = await server.inject({
      method: 'POST',
      url: '/v1/vessels/vessel-1/favourite-ports',
      headers: { authorization: 'Bearer test-actor-token' },
      payload: { portId: 'port-1', status: 'SUBMITTED' }
    })

    expect(response.statusCode).toBe(400)
  })

  test('POST favourite-ports rejects a missing portId with a safe 400', async () => {
    const { server } = await createTestServer()

    const response = await server.inject({
      method: 'POST',
      url: '/v1/vessels/vessel-1/favourite-ports',
      headers: { authorization: 'Bearer test-actor-token' },
      payload: {}
    })

    expect(response.statusCode).toBe(400)
  })

  test('POST favourite-ports rejects a bearer token requirement with 401', async () => {
    const { server } = await createTestServer()

    const response = await server.inject({
      method: 'POST',
      url: '/v1/vessels/vessel-1/favourite-ports',
      payload: { portId: 'port-1' }
    })

    expect(response.statusCode).toBe(401)
  })

  test('POST favourite-ports denies a vessel the caller cannot access with a safe 403', async () => {
    const { server } = await createTestServer()
    mockVesselAccess({ accessibleVesselIds: ['vessel-2'] })

    const response = await server.inject({
      method: 'POST',
      url: '/v1/vessels/vessel-1/favourite-ports',
      headers: { authorization: 'Bearer test-actor-token' },
      payload: { portId: 'port-1' }
    })

    expect(response.statusCode).toBe(403)
  })

  test('DELETE favourite-ports/{portId} is safe to repeat and returns 204', async () => {
    const { server } = await createTestServer()
    mockVesselAccess()

    const first = await server.inject({
      method: 'DELETE',
      url: '/v1/vessels/vessel-1/favourite-ports/port-1',
      headers: { authorization: 'Bearer test-actor-token' }
    })
    expect(first.statusCode).toBe(204)

    mockVesselAccess()
    const second = await server.inject({
      method: 'DELETE',
      url: '/v1/vessels/vessel-1/favourite-ports/port-1',
      headers: { authorization: 'Bearer test-actor-token' }
    })
    expect(second.statusCode).toBe(204)
  })
})

describe('vessel skipper routes', () => {
  test('GET skippers returns an empty list when no profile exists', async () => {
    const { server } = await createTestServer()
    mockVesselAccess()

    const response = await server.inject({
      method: 'GET',
      url: '/v1/vessels/vessel-1/skippers',
      headers: { authorization: 'Bearer test-actor-token' }
    })

    expect(response.statusCode).toBe(200)
    expect(JSON.parse(response.payload)).toEqual({
      vesselId: 'vessel-1',
      skippers: []
    })
  })

  test('POST skippers adds a skipper with a server-generated id', async () => {
    const { server } = await createTestServer()
    mockVesselAccess()

    const response = await server.inject({
      method: 'POST',
      url: '/v1/vessels/vessel-1/skippers',
      headers: { authorization: 'Bearer test-actor-token' },
      payload: { name: 'Jane Doe', phoneNumber: '01234' }
    })

    expect(response.statusCode).toBe(200)
    const body = JSON.parse(response.payload)
    expect(body.skippers).toHaveLength(1)
    expect(body.skippers[0]).toMatchObject({
      name: 'Jane Doe',
      phoneNumber: '01234',
      email: null
    })
  })

  test('POST skippers rejects an invalid email with a safe 400', async () => {
    const { server } = await createTestServer()

    const response = await server.inject({
      method: 'POST',
      url: '/v1/vessels/vessel-1/skippers',
      headers: { authorization: 'Bearer test-actor-token' },
      payload: { name: 'Jane Doe', email: 'not-an-email' }
    })

    expect(response.statusCode).toBe(400)
  })

  test('POST skippers rejects a missing name with a safe 400', async () => {
    const { server } = await createTestServer()

    const response = await server.inject({
      method: 'POST',
      url: '/v1/vessels/vessel-1/skippers',
      headers: { authorization: 'Bearer test-actor-token' },
      payload: {}
    })

    expect(response.statusCode).toBe(400)
  })

  test('DELETE skippers/{skipperId} removes the skipper and is safe to repeat', async () => {
    const { server } = await createTestServer()
    mockVesselAccess()

    const added = await server.inject({
      method: 'POST',
      url: '/v1/vessels/vessel-1/skippers',
      headers: { authorization: 'Bearer test-actor-token' },
      payload: { name: 'Jane Doe' }
    })
    const skipperId = JSON.parse(added.payload).skippers[0].id

    mockVesselAccess()
    const first = await server.inject({
      method: 'DELETE',
      url: `/v1/vessels/vessel-1/skippers/${skipperId}`,
      headers: { authorization: 'Bearer test-actor-token' }
    })
    expect(first.statusCode).toBe(204)

    mockVesselAccess()
    const second = await server.inject({
      method: 'DELETE',
      url: `/v1/vessels/vessel-1/skippers/${skipperId}`,
      headers: { authorization: 'Bearer test-actor-token' }
    })
    expect(second.statusCode).toBe(204)
  })

  test('POST skippers denies a vessel the caller cannot access with a safe 403', async () => {
    const { server } = await createTestServer()
    mockVesselAccess({ accessibleVesselIds: ['vessel-2'] })

    const response = await server.inject({
      method: 'POST',
      url: '/v1/vessels/vessel-1/skippers',
      headers: { authorization: 'Bearer test-actor-token' },
      payload: { name: 'Jane Doe' }
    })

    expect(response.statusCode).toBe(403)
  })
})
