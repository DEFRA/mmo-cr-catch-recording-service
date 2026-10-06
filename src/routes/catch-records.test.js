/* global fetchMock */
import Hapi from '@hapi/hapi'

import { catchRecords } from './catch-records.js'
import { authenticationPlugin } from '#/catch-recording/controller/authentication-plugin.js'
import { referenceDataPlugin } from '#/catch-recording/controller/reference-data-plugin.js'
import { errorMapping } from '#/plugins/error-mapping.js'
import { requestTracing } from '#/plugins/request-tracing.js'
import { failAction } from '#/common/helpers/fail-action.js'

vi.mock('@defra/cdp-auditing', () => ({ audit: vi.fn() }))

const AUTH_OPTIONS = {
  baseUrl: 'https://authentication-service.example',
  timeoutMs: 1000,
  retryCount: 0,
  retryDelayMs: 0,
  tracingHeader: 'x-cdp-request-id'
}

const REFERENCE_DATA_OPTIONS = {
  baseUrl: 'https://reference-data-service.example',
  serviceToken: 'service-token',
  timeoutMs: 1000,
  retryCount: 0,
  retryDelayMs: 0,
  tracingHeader: 'x-cdp-request-id'
}

function fakeDb() {
  const store = new Map()
  const collections = {
    'catch-records': {
      insertOne: vi.fn(async (document) => {
        store.set(document._id, document)
        return { acknowledged: true, insertedId: document._id }
      }),
      findOne: vi.fn(async (filter) => {
        for (const document of store.values()) {
          if (
            Object.entries(filter).every(
              ([key, value]) => document[key] === value
            )
          ) {
            return document
          }
        }
        return null
      }),
      findOneAndDelete: vi.fn(async (filter) => {
        for (const [id, document] of store.entries()) {
          if (
            Object.entries(filter).every(
              ([key, value]) => document[key] === value
            )
          ) {
            store.delete(id)
            return document
          }
        }
        return null
      }),
      findOneAndUpdate: vi.fn(async (filter, update) => {
        for (const [id, document] of store.entries()) {
          if (
            Object.entries(filter).every(
              ([key, value]) => document[key] === value
            )
          ) {
            const updated = { ...document, ...(update.$set ?? {}) }
            if (update.$inc) {
              for (const [key, amount] of Object.entries(update.$inc)) {
                updated[key] = (document[key] ?? 0) + amount
              }
            }
            store.set(id, updated)
            return updated
          }
        }
        return null
      }),
      find: vi.fn((filter = {}) => {
        const matches = [...store.values()].filter((document) =>
          Object.entries(filter).every(
            ([key, value]) => document[key] === value
          )
        )
        return {
          sort: () => ({
            limit: (limit) => ({
              toArray: async () =>
                [...matches]
                  .sort((a, b) => {
                    if (a.createdAt !== b.createdAt) {
                      return a.createdAt < b.createdAt ? 1 : -1
                    }
                    return a._id < b._id ? -1 : 1
                  })
                  .slice(0, limit)
            })
          })
        }
      }),
      createIndex: vi.fn(),
      seed: (document) => store.set(document._id, document)
    },
    'catch-record-history': (() => {
      const historyStore = new Map()
      let nextId = 1
      return {
        insertOne: vi.fn(async (document) => {
          const id = document._id ?? `history-${nextId++}`
          historyStore.set(id, { ...document, _id: id })
          return { acknowledged: true, insertedId: id }
        }),
        find: vi.fn((filter = {}) => {
          const matches = [...historyStore.values()].filter((document) =>
            Object.entries(filter).every(
              ([key, value]) => document[key] === value
            )
          )
          return {
            sort: () => ({
              limit: (limit) => ({
                toArray: async () =>
                  [...matches]
                    .sort((a, b) => {
                      if (a.timestamp !== b.timestamp) {
                        return a.timestamp < b.timestamp ? -1 : 1
                      }
                      return a._id < b._id ? -1 : 1
                    })
                    .slice(0, limit)
              })
            })
          }
        }),
        createIndex: vi.fn(),
        seed: (document) => historyStore.set(document._id, document)
      }
    })()
  }

  return { collection: (name) => collections[name], collections }
}

async function createTestServer() {
  const server = Hapi.server({
    routes: { validate: { options: { abortEarly: false }, failAction } }
  })

  await server.register(requestTracing)
  await server.register(errorMapping)
  await server.register({ plugin: authenticationPlugin, options: AUTH_OPTIONS })
  await server.register({
    plugin: referenceDataPlugin,
    options: REFERENCE_DATA_OPTIONS
  })

  const db = fakeDb()
  server.decorate('request', 'db', () => db, { apply: true })

  server.route(catchRecords)

  return { server, db }
}

function validVesselBody() {
  return {
    id: 'vessel-1',
    name: 'Example Vessel',
    namePln: null,
    identifiers: {
      cfr: null,
      uvi: null,
      mmsi: null,
      ircs: null,
      externalMark: 'PZ1',
      registrationNumber: 'RSS123456'
    },
    lengthOverallMetres: 9.5,
    status: 'active',
    activeFrom: '2020-01-01',
    activeTo: null
  }
}

function mockSuccessfulAuthAndVessel() {
  fetchMock.mockResponseOnce(
    JSON.stringify({ actorId: 'owner-1', permissions: [] })
  )
  fetchMock.mockResponseOnce(JSON.stringify([{ id: 'vessel-1' }]))
  fetchMock.mockResponseOnce(JSON.stringify(validVesselBody()))
}

describe('POST /v1/catch-records', () => {
  test('creates a DRAFT and returns the standard save response', async () => {
    const { server } = await createTestServer()
    mockSuccessfulAuthAndVessel()

    const response = await server.inject({
      method: 'POST',
      url: '/v1/catch-records',
      headers: { authorization: 'Bearer token-1' },
      payload: { vesselId: 'vessel-1' }
    })

    expect(response.statusCode).toBe(201)
    const body = JSON.parse(response.payload)
    expect(body.status).toBe('DRAFT')
    expect(body.catchRecordReference).toMatch(/^GBR-RSS123456-\d{6}-\d{6}$/)
    expect(body.version).toBe(1)
  })

  test('rejects a missing vesselId with a safe 400', async () => {
    const { server } = await createTestServer()
    fetchMock.mockResponseOnce(
      JSON.stringify({ actorId: 'owner-1', permissions: [] })
    )

    const response = await server.inject({
      method: 'POST',
      url: '/v1/catch-records',
      headers: { authorization: 'Bearer token-1' },
      payload: {}
    })

    expect(response.statusCode).toBe(400)
  })

  test('rejects a missing bearer token with 401', async () => {
    const { server } = await createTestServer()

    const response = await server.inject({
      method: 'POST',
      url: '/v1/catch-records',
      payload: { vesselId: 'vessel-1' }
    })

    expect(response.statusCode).toBe(401)
  })

  test('rejects a vessel the caller cannot access with 403', async () => {
    const { server } = await createTestServer()
    fetchMock.mockResponseOnce(
      JSON.stringify({ actorId: 'owner-1', permissions: [] })
    )
    fetchMock.mockResponseOnce(JSON.stringify([]))
    fetchMock.mockResponseOnce(JSON.stringify(validVesselBody()))

    const response = await server.inject({
      method: 'POST',
      url: '/v1/catch-records',
      headers: { authorization: 'Bearer token-1' },
      payload: { vesselId: 'vessel-1' }
    })

    expect(response.statusCode).toBe(403)
  })
})

function eligibleDraftDocument(overrides = {}) {
  return {
    _id: 'record-1',
    schemaVersion: 1,
    catchRecordReference: 'GBR-RSS123456-051026-113500',
    ownerUserId: 'owner-1',
    status: 'DRAFT',
    numberOfSubmissions: 0,
    submittedAt: null,
    submittedBy: null,
    version: 1,
    gears: [],
    ...overrides
  }
}

function gearCollectionResponse({
  gearId = 'gear-1',
  characteristicId = 'char-1',
  active = true
} = {}) {
  return {
    items: [
      {
        id: gearId,
        code: 'GEAR001',
        name: 'Otter trawl',
        type: 'trawl',
        categoryId: 'cat-1',
        pairFishing: false,
        active,
        applicableCharacteristics: [
          {
            id: 'applicable-1',
            characteristicId,
            fixed: false,
            required: true,
            vesselLengthApplicability: []
          }
        ]
      }
    ],
    characteristics: [
      {
        id: characteristicId,
        code: 'MESH',
        name: 'Mesh size',
        dataType: 'number',
        unit: 'mm',
        minValue: 0,
        maxValue: 300
      }
    ]
  }
}

function gearNotFoundResponse() {
  return { items: [], characteristics: [] }
}

function statisticalAreaFeatureResponse({
  id = 'area-2',
  code = '46F45',
  name = 'ICES 46F45'
} = {}) {
  return {
    type: 'Feature',
    properties: { id, code, name, areaType: 'ICES' },
    geometry: { type: 'Point', coordinates: [0, 0] }
  }
}

function speciesResponse({
  id = 'species-2',
  faoCode = 'HAD',
  scientificName = 'Melanogrammus aeglefinus',
  commonName = 'Haddock',
  active = true
} = {}) {
  return {
    id,
    faoCode,
    scientificName,
    commonNames: [{ id: 'cn-1', countryCode: 'GB', name: commonName }],
    localNames: [],
    active
  }
}

function existingGear(overrides = {}) {
  return {
    associationId: 'gear-assoc-1',
    gear: { id: 'gear-1', codeSnapshot: 'OLD_CODE', nameSnapshot: 'Old Name' },
    characteristics: [],
    statisticalArea: {
      id: 'area-1',
      codeSnapshot: 'A1',
      nameSnapshot: 'Area One'
    },
    speciesCaught: [
      {
        id: 'species-1',
        faoCodeSnapshot: 'COD',
        nameSnapshot: 'Cod',
        weightAboveMinimumKg: 5
      }
    ],
    ...overrides
  }
}

describe('DELETE /v1/catch-records/{catchRecordId}', () => {
  test('abandons an eligible draft and returns 204', async () => {
    const { server, db } = await createTestServer()
    db.collections['catch-records'].seed(eligibleDraftDocument())
    fetchMock.mockResponseOnce(
      JSON.stringify({ actorId: 'owner-1', permissions: [] })
    )

    const response = await server.inject({
      method: 'DELETE',
      url: '/v1/catch-records/record-1',
      headers: { authorization: 'Bearer token-1', 'if-match': '1' }
    })

    expect(response.statusCode).toBe(204)
  })

  test('is idempotent: deleting an already-abandoned draft again still returns 204', async () => {
    const { server, db } = await createTestServer()
    db.collections['catch-records'].seed(eligibleDraftDocument())
    fetchMock.mockResponse(
      JSON.stringify({ actorId: 'owner-1', permissions: [] })
    )

    const first = await server.inject({
      method: 'DELETE',
      url: '/v1/catch-records/record-1',
      headers: { authorization: 'Bearer token-1', 'if-match': '1' }
    })
    const second = await server.inject({
      method: 'DELETE',
      url: '/v1/catch-records/record-1',
      headers: { authorization: 'Bearer token-1', 'if-match': '1' }
    })

    expect(first.statusCode).toBe(204)
    expect(second.statusCode).toBe(204)
  })

  test('rejects a missing/malformed If-Match header with 400', async () => {
    const { server } = await createTestServer()
    fetchMock.mockResponseOnce(
      JSON.stringify({ actorId: 'owner-1', permissions: [] })
    )

    const response = await server.inject({
      method: 'DELETE',
      url: '/v1/catch-records/record-1',
      headers: { authorization: 'Bearer token-1' }
    })

    expect(response.statusCode).toBe(400)
  })

  test('rejects a missing bearer token with 401', async () => {
    const { server } = await createTestServer()

    const response = await server.inject({
      method: 'DELETE',
      url: '/v1/catch-records/record-1',
      headers: { 'if-match': '1' }
    })

    expect(response.statusCode).toBe(401)
  })

  test('rejects a submitted record with 409 (ineligible transition)', async () => {
    const { server, db } = await createTestServer()
    db.collections['catch-records'].seed(
      eligibleDraftDocument({
        status: 'SUBMITTED',
        numberOfSubmissions: 1,
        submittedAt: '2026-10-05T12:15:00Z',
        submittedBy: 'owner-1'
      })
    )
    fetchMock.mockResponseOnce(
      JSON.stringify({ actorId: 'owner-1', permissions: [] })
    )

    const response = await server.inject({
      method: 'DELETE',
      url: '/v1/catch-records/record-1',
      headers: { authorization: 'Bearer token-1', 'if-match': '1' }
    })

    expect(response.statusCode).toBe(409)
  })

  test('rejects a stale expected version with 409', async () => {
    const { server, db } = await createTestServer()
    db.collections['catch-records'].seed(eligibleDraftDocument({ version: 2 }))
    fetchMock.mockResponseOnce(
      JSON.stringify({ actorId: 'owner-1', permissions: [] })
    )

    const response = await server.inject({
      method: 'DELETE',
      url: '/v1/catch-records/record-1',
      headers: { authorization: 'Bearer token-1', 'if-match': '1' }
    })

    expect(response.statusCode).toBe(409)
  })
})

describe('PATCH /v1/catch-records/{catchRecordId}', () => {
  test('saves the trip section and returns 200 with the standard save response', async () => {
    const { server, db } = await createTestServer()
    db.collections['catch-records'].seed(eligibleDraftDocument())
    fetchMock.mockResponseOnce(
      JSON.stringify({ actorId: 'owner-1', permissions: [] })
    )
    fetchMock.mockResponseOnce(
      JSON.stringify({
        id: 'port-1',
        code: '0349',
        name: 'Plymouth',
        countryCode: 'GB',
        coordinate: null,
        active: true
      })
    )
    fetchMock.mockResponseOnce(
      JSON.stringify({
        id: 'port-1',
        code: '0349',
        name: 'Plymouth',
        countryCode: 'GB',
        coordinate: null,
        active: true
      })
    )

    const response = await server.inject({
      method: 'PATCH',
      url: '/v1/catch-records/record-1',
      headers: { authorization: 'Bearer token-1', 'if-match': '1' },
      payload: {
        section: 'trip',
        data: {
          startedAndFinishedToday: true,
          departurePort: { id: 'port-1' },
          returnPort: { id: 'port-1' }
        }
      }
    })

    expect(response.statusCode).toBe(200)
    const body = JSON.parse(response.payload)
    expect(body.savedSection).toBe('trip')
    expect(body.version).toBe(2)
  })

  test('saves the pairFishing section and returns 200', async () => {
    const { server, db } = await createTestServer()
    db.collections['catch-records'].seed(eligibleDraftDocument())
    fetchMock.mockResponseOnce(
      JSON.stringify({ actorId: 'owner-1', permissions: [] })
    )

    const response = await server.inject({
      method: 'PATCH',
      url: '/v1/catch-records/record-1',
      headers: { authorization: 'Bearer token-1', 'if-match': '1' },
      payload: { section: 'pairFishing', data: { enabled: false } }
    })

    expect(response.statusCode).toBe(200)
    const body = JSON.parse(response.payload)
    expect(body.savedSection).toBe('pairFishing')
  })

  test('rejects an unsupported section name with 400', async () => {
    const { server } = await createTestServer()
    fetchMock.mockResponseOnce(
      JSON.stringify({ actorId: 'owner-1', permissions: [] })
    )

    const response = await server.inject({
      method: 'PATCH',
      url: '/v1/catch-records/record-1',
      headers: { authorization: 'Bearer token-1', 'if-match': '1' },
      payload: { section: 'notASupportedSection', data: {} }
    })

    expect(response.statusCode).toBe(400)
  })

  test('rejects a malformed (non-array) gears payload with 400', async () => {
    const { server } = await createTestServer()
    fetchMock.mockResponseOnce(
      JSON.stringify({ actorId: 'owner-1', permissions: [] })
    )

    const response = await server.inject({
      method: 'PATCH',
      url: '/v1/catch-records/record-1',
      headers: { authorization: 'Bearer token-1', 'if-match': '1' },
      payload: { section: 'gears', data: {} }
    })

    expect(response.statusCode).toBe(400)
  })

  test('rejects a missing bearer token with 401', async () => {
    const { server } = await createTestServer()

    const response = await server.inject({
      method: 'PATCH',
      url: '/v1/catch-records/record-1',
      headers: { 'if-match': '1' },
      payload: { section: 'pairFishing', data: { enabled: false } }
    })

    expect(response.statusCode).toBe(401)
  })

  test('rejects a missing/malformed If-Match header with 400', async () => {
    const { server } = await createTestServer()
    fetchMock.mockResponseOnce(
      JSON.stringify({ actorId: 'owner-1', permissions: [] })
    )

    const response = await server.inject({
      method: 'PATCH',
      url: '/v1/catch-records/record-1',
      headers: { authorization: 'Bearer token-1' },
      payload: { section: 'pairFishing', data: { enabled: false } }
    })

    expect(response.statusCode).toBe(400)
  })

  test('rejects a missing catch record with 404', async () => {
    const { server } = await createTestServer()
    fetchMock.mockResponseOnce(
      JSON.stringify({ actorId: 'owner-1', permissions: [] })
    )

    const response = await server.inject({
      method: 'PATCH',
      url: '/v1/catch-records/does-not-exist',
      headers: { authorization: 'Bearer token-1', 'if-match': '1' },
      payload: { section: 'pairFishing', data: { enabled: false } }
    })

    expect(response.statusCode).toBe(404)
  })

  test('rejects a stale expected version with 409', async () => {
    const { server, db } = await createTestServer()
    db.collections['catch-records'].seed(eligibleDraftDocument({ version: 2 }))
    fetchMock.mockResponseOnce(
      JSON.stringify({ actorId: 'owner-1', permissions: [] })
    )

    const response = await server.inject({
      method: 'PATCH',
      url: '/v1/catch-records/record-1',
      headers: { authorization: 'Bearer token-1', 'if-match': '1' },
      payload: { section: 'pairFishing', data: { enabled: false } }
    })

    expect(response.statusCode).toBe(409)
  })

  test('rejects an invalid section payload with a safe 422', async () => {
    const { server, db } = await createTestServer()
    db.collections['catch-records'].seed(eligibleDraftDocument())
    fetchMock.mockResponseOnce(
      JSON.stringify({ actorId: 'owner-1', permissions: [] })
    )

    const response = await server.inject({
      method: 'PATCH',
      url: '/v1/catch-records/record-1',
      headers: { authorization: 'Bearer token-1', 'if-match': '1' },
      payload: {
        section: 'trip',
        data: { startedAndFinishedToday: false }
      }
    })

    expect(response.statusCode).toBe(422)
  })

  test('saves a new gear occurrence, generating a stable associationId', async () => {
    const { server, db } = await createTestServer()
    db.collections['catch-records'].seed(eligibleDraftDocument())
    fetchMock.mockResponseOnce(
      JSON.stringify({ actorId: 'owner-1', permissions: [] })
    )
    fetchMock.mockResponseOnce(JSON.stringify(gearCollectionResponse()))

    const response = await server.inject({
      method: 'PATCH',
      url: '/v1/catch-records/record-1',
      headers: { authorization: 'Bearer token-1', 'if-match': '1' },
      payload: {
        section: 'gears',
        data: [
          {
            gear: { id: 'gear-1' },
            characteristics: [{ characteristicId: 'char-1', value: 80 }]
          }
        ]
      }
    })

    expect(response.statusCode).toBe(200)
    const body = JSON.parse(response.payload)
    expect(body.savedSection).toBe('gears')
    expect(body.version).toBe(2)

    const updateCall =
      db.collections['catch-records'].findOneAndUpdate.mock.calls[0][1].$set
    expect(updateCall.gears).toHaveLength(1)
    expect(typeof updateCall.gears[0].associationId).toBe('string')
    expect(updateCall.gears[0].associationId.length).toBeGreaterThan(0)
    expect(updateCall.gears[0].gear).toEqual({
      id: 'gear-1',
      codeSnapshot: 'GEAR001',
      nameSnapshot: 'Otter trawl'
    })
    expect(updateCall.gears[0].speciesCaught).toEqual([])
  })

  test('retains an existing gear occurrence, preserving its nested dependent data', async () => {
    const { server, db } = await createTestServer()
    db.collections['catch-records'].seed(
      eligibleDraftDocument({ gears: [existingGear()] })
    )
    fetchMock.mockResponseOnce(
      JSON.stringify({ actorId: 'owner-1', permissions: [] })
    )
    fetchMock.mockResponseOnce(JSON.stringify(gearCollectionResponse()))

    const response = await server.inject({
      method: 'PATCH',
      url: '/v1/catch-records/record-1',
      headers: { authorization: 'Bearer token-1', 'if-match': '1' },
      payload: {
        section: 'gears',
        data: [
          {
            associationId: 'gear-assoc-1',
            gear: { id: 'gear-1' },
            characteristics: []
          }
        ]
      }
    })

    expect(response.statusCode).toBe(200)
    const updateCall =
      db.collections['catch-records'].findOneAndUpdate.mock.calls[0][1].$set
    expect(updateCall.gears).toHaveLength(1)
    expect(updateCall.gears[0].associationId).toBe('gear-assoc-1')
    expect(updateCall.gears[0].gear.codeSnapshot).toBe('GEAR001')
    expect(updateCall.gears[0].statisticalArea).toEqual(
      existingGear().statisticalArea
    )
    expect(updateCall.gears[0].speciesCaught).toEqual(
      existingGear().speciesCaught
    )
  })

  test('drops a deselected gear occurrence, cascading its nested dependent data', async () => {
    const { server, db } = await createTestServer()
    db.collections['catch-records'].seed(
      eligibleDraftDocument({
        gears: [
          existingGear({ associationId: 'gear-assoc-1' }),
          existingGear({
            associationId: 'gear-assoc-2',
            gear: { id: 'gear-2', codeSnapshot: 'G2', nameSnapshot: 'Gear 2' }
          })
        ]
      })
    )
    fetchMock.mockResponseOnce(
      JSON.stringify({ actorId: 'owner-1', permissions: [] })
    )
    fetchMock.mockResponseOnce(JSON.stringify(gearCollectionResponse()))

    const response = await server.inject({
      method: 'PATCH',
      url: '/v1/catch-records/record-1',
      headers: { authorization: 'Bearer token-1', 'if-match': '1' },
      payload: {
        section: 'gears',
        data: [
          {
            associationId: 'gear-assoc-1',
            gear: { id: 'gear-1' },
            characteristics: []
          }
        ]
      }
    })

    expect(response.statusCode).toBe(200)
    const updateCall =
      db.collections['catch-records'].findOneAndUpdate.mock.calls[0][1].$set
    expect(updateCall.gears).toHaveLength(1)
    expect(updateCall.gears[0].associationId).toBe('gear-assoc-1')
  })

  test('Step 24: sets a statistical area under the target gear and returns 200', async () => {
    const { server, db } = await createTestServer()
    db.collections['catch-records'].seed(
      eligibleDraftDocument({ gears: [existingGear()] })
    )
    fetchMock.mockResponseOnce(
      JSON.stringify({ actorId: 'owner-1', permissions: [] })
    )
    fetchMock.mockResponseOnce(JSON.stringify(gearCollectionResponse()))
    fetchMock.mockResponseOnce(JSON.stringify(statisticalAreaFeatureResponse()))

    const response = await server.inject({
      method: 'PATCH',
      url: '/v1/catch-records/record-1',
      headers: { authorization: 'Bearer test-token-1', 'if-match': '1' },
      payload: {
        section: 'gears',
        data: [
          {
            associationId: 'gear-assoc-1',
            gear: { id: 'gear-1' },
            characteristics: [],
            statisticalArea: { id: 'area-2' }
          }
        ]
      }
    })

    expect(response.statusCode).toBe(200)
    const updateCall =
      db.collections['catch-records'].findOneAndUpdate.mock.calls[0][1].$set
    expect(updateCall.gears[0].statisticalArea).toEqual({
      id: 'area-2',
      codeSnapshot: '46F45',
      nameSnapshot: 'ICES 46F45'
    })
  })

  test('Step 24: rejects an invalid/not-found statistical area with a safe 422', async () => {
    const { server, db } = await createTestServer()
    db.collections['catch-records'].seed(eligibleDraftDocument())
    fetchMock.mockResponseOnce(
      JSON.stringify({ actorId: 'owner-1', permissions: [] })
    )
    fetchMock.mockResponseOnce(JSON.stringify(gearCollectionResponse()))
    fetchMock.mockResponseOnce(JSON.stringify({ status: 404 }), {
      status: 404
    })

    const response = await server.inject({
      method: 'PATCH',
      url: '/v1/catch-records/record-1',
      headers: { authorization: 'Bearer test-token-1', 'if-match': '1' },
      payload: {
        section: 'gears',
        data: [{ gear: { id: 'gear-1' }, statisticalArea: { id: 'missing' } }]
      }
    })

    expect(response.statusCode).toBe(422)
  })

  test('Step 27: adds a new species entry with weight fields and returns 200', async () => {
    const { server, db } = await createTestServer()
    db.collections['catch-records'].seed(
      eligibleDraftDocument({
        gears: [existingGear({ speciesCaught: [] })]
      })
    )
    fetchMock.mockResponseOnce(
      JSON.stringify({ actorId: 'owner-1', permissions: [] })
    )
    fetchMock.mockResponseOnce(JSON.stringify(gearCollectionResponse()))
    fetchMock.mockResponseOnce(JSON.stringify(speciesResponse()))

    const response = await server.inject({
      method: 'PATCH',
      url: '/v1/catch-records/record-1',
      headers: { authorization: 'Bearer token-1', 'if-match': '1' },
      payload: {
        section: 'gears',
        data: [
          {
            associationId: 'gear-assoc-1',
            gear: { id: 'gear-1' },
            characteristics: [],
            speciesCaught: [
              {
                id: 'species-2',
                weightAboveMinimumKg: 5,
                weightPrecision: 'wholeNumber'
              }
            ]
          }
        ]
      }
    })

    expect(response.statusCode).toBe(200)
    const updateCall =
      db.collections['catch-records'].findOneAndUpdate.mock.calls[0][1].$set
    const speciesCaught = updateCall.gears[0].speciesCaught
    expect(speciesCaught).toEqual([
      {
        id: 'species-2',
        faoCodeSnapshot: 'HAD',
        nameSnapshot: 'Haddock',
        weightAboveMinimumKg: 5,
        weightPrecision: 'wholeNumber'
      }
    ])
  })

  test('Step 27: rejects a species that cannot be resolved with a safe 422', async () => {
    const { server, db } = await createTestServer()
    db.collections['catch-records'].seed(
      eligibleDraftDocument({ gears: [existingGear({ speciesCaught: [] })] })
    )
    fetchMock.mockResponseOnce(
      JSON.stringify({ actorId: 'owner-1', permissions: [] })
    )
    fetchMock.mockResponseOnce(JSON.stringify(gearCollectionResponse()))
    fetchMock.mockResponseOnce(JSON.stringify({ status: 404 }), {
      status: 404
    })

    const response = await server.inject({
      method: 'PATCH',
      url: '/v1/catch-records/record-1',
      headers: { authorization: 'Bearer token-1', 'if-match': '1' },
      payload: {
        section: 'gears',
        data: [
          {
            associationId: 'gear-assoc-1',
            gear: { id: 'gear-1' },
            characteristics: [],
            speciesCaught: [{ id: 'missing-species' }]
          }
        ]
      }
    })

    expect(response.statusCode).toBe(422)
  })

  test('rejects a gear that cannot be resolved with a safe 422', async () => {
    const { server, db } = await createTestServer()
    db.collections['catch-records'].seed(eligibleDraftDocument())
    fetchMock.mockResponseOnce(
      JSON.stringify({ actorId: 'owner-1', permissions: [] })
    )
    fetchMock.mockResponseOnce(JSON.stringify(gearNotFoundResponse()))

    const response = await server.inject({
      method: 'PATCH',
      url: '/v1/catch-records/record-1',
      headers: { authorization: 'Bearer token-1', 'if-match': '1' },
      payload: { section: 'gears', data: [{ gear: { id: 'missing-gear' } }] }
    })

    expect(response.statusCode).toBe(422)
  })

  test('rejects a stale expected version for gears with 409', async () => {
    const { server, db } = await createTestServer()
    db.collections['catch-records'].seed(eligibleDraftDocument({ version: 2 }))
    fetchMock.mockResponseOnce(
      JSON.stringify({ actorId: 'owner-1', permissions: [] })
    )

    const response = await server.inject({
      method: 'PATCH',
      url: '/v1/catch-records/record-1',
      headers: { authorization: 'Bearer token-1', 'if-match': '1' },
      payload: { section: 'gears', data: [] }
    })

    expect(response.statusCode).toBe(409)
  })

  test('rejects a missing catch record for gears with 404', async () => {
    const { server } = await createTestServer()
    fetchMock.mockResponseOnce(
      JSON.stringify({ actorId: 'owner-1', permissions: [] })
    )

    const response = await server.inject({
      method: 'PATCH',
      url: '/v1/catch-records/does-not-exist',
      headers: { authorization: 'Bearer token-1', 'if-match': '1' },
      payload: { section: 'gears', data: [] }
    })

    expect(response.statusCode).toBe(404)
  })

  test('leaves unrelated fields unchanged when saving gears', async () => {
    const { server, db } = await createTestServer()
    db.collections['catch-records'].seed(eligibleDraftDocument())
    fetchMock.mockResponseOnce(
      JSON.stringify({ actorId: 'owner-1', permissions: [] })
    )
    fetchMock.mockResponseOnce(JSON.stringify(gearCollectionResponse()))

    await server.inject({
      method: 'PATCH',
      url: '/v1/catch-records/record-1',
      headers: { authorization: 'Bearer token-1', 'if-match': '1' },
      payload: { section: 'gears', data: [{ gear: { id: 'gear-1' } }] }
    })

    const updateCall =
      db.collections['catch-records'].findOneAndUpdate.mock.calls[0][1].$set
    expect(updateCall.trip).toBeUndefined()
    expect(updateCall.vessel).toBeUndefined()
  })
})

function listingDocument(overrides = {}) {
  return {
    _id: 'record-1',
    schemaVersion: 1,
    catchRecordReference: 'GBR-RSS123456-051026-113500',
    ownerUserId: 'owner-1',
    status: 'DRAFT',
    numberOfSubmissions: 0,
    hasUnsubmittedChanges: false,
    submittedAt: null,
    submittedBy: null,
    completedAt: null,
    completedBy: null,
    version: 1,
    vessel: {
      id: 'vessel-1',
      nameSnapshot: 'Example Vessel',
      rssSnapshot: 'RSS123456'
    },
    trip: { dateStarted: '2026-10-05', dateEnded: '2026-10-05' },
    pairFishing: { enabled: false, pairVessel: null, pairSkipperName: null },
    gears: [],
    speciesNotLanded: [],
    artifacts: [],
    createdAt: '2026-10-05T10:35:00Z',
    createdBy: 'owner-1',
    updatedAt: '2026-10-05T10:35:00Z',
    updatedBy: 'owner-1',
    ...overrides
  }
}

describe('GET /v1/catch-records', () => {
  test("returns only the authenticated owner's records as minimal summaries", async () => {
    const { server, db } = await createTestServer()
    db.collections['catch-records'].seed(listingDocument())
    db.collections['catch-records'].seed(
      listingDocument({ _id: 'record-2', ownerUserId: 'owner-2' })
    )
    fetchMock.mockResponseOnce(
      JSON.stringify({ actorId: 'owner-1', permissions: [] })
    )

    const response = await server.inject({
      method: 'GET',
      url: '/v1/catch-records',
      headers: { authorization: 'Bearer token-1' }
    })

    expect(response.statusCode).toBe(200)
    const body = JSON.parse(response.payload)
    expect(body.count).toBe(1)
    expect(body.limit).toBe(20)
    expect(body.items).toHaveLength(1)
    expect(body.items[0]).toMatchObject({
      id: 'record-1',
      catchRecordReference: 'GBR-RSS123456-051026-113500',
      status: 'DRAFT',
      displayStatus: 'Draft'
    })
    expect(body.items[0]).not.toHaveProperty('gears')
    expect(body.items[0]).not.toHaveProperty('ownerUserId')
  })

  test('returns a successful empty list when the owner has no records', async () => {
    const { server } = await createTestServer()
    fetchMock.mockResponseOnce(
      JSON.stringify({ actorId: 'owner-1', permissions: [] })
    )

    const response = await server.inject({
      method: 'GET',
      url: '/v1/catch-records',
      headers: { authorization: 'Bearer token-1' }
    })

    expect(response.statusCode).toBe(200)
    expect(JSON.parse(response.payload)).toEqual({
      items: [],
      limit: 20,
      count: 0
    })
  })

  test('applies an explicit status filter', async () => {
    const { server, db } = await createTestServer()
    db.collections['catch-records'].seed(listingDocument())
    db.collections['catch-records'].seed(
      listingDocument({ _id: 'record-2', status: 'SUBMITTED' })
    )
    fetchMock.mockResponseOnce(
      JSON.stringify({ actorId: 'owner-1', permissions: [] })
    )

    const response = await server.inject({
      method: 'GET',
      url: '/v1/catch-records?status=SUBMITTED',
      headers: { authorization: 'Bearer token-1' }
    })

    const body = JSON.parse(response.payload)
    expect(body.items).toHaveLength(1)
    expect(body.items[0].id).toBe('record-2')
  })

  test('rejects an unsupported status value with a safe 400', async () => {
    const { server } = await createTestServer()
    fetchMock.mockResponseOnce(
      JSON.stringify({ actorId: 'owner-1', permissions: [] })
    )

    const response = await server.inject({
      method: 'GET',
      url: '/v1/catch-records?status=AMENDED',
      headers: { authorization: 'Bearer token-1' }
    })

    expect(response.statusCode).toBe(400)
  })

  test('rejects an unknown query parameter with a safe 400', async () => {
    const { server } = await createTestServer()
    fetchMock.mockResponseOnce(
      JSON.stringify({ actorId: 'owner-1', permissions: [] })
    )

    const response = await server.inject({
      method: 'GET',
      url: '/v1/catch-records?vesselId=vessel-1',
      headers: { authorization: 'Bearer token-1' }
    })

    expect(response.statusCode).toBe(400)
  })

  test('rejects a limit above the approved maximum with a safe 400', async () => {
    const { server } = await createTestServer()
    fetchMock.mockResponseOnce(
      JSON.stringify({ actorId: 'owner-1', permissions: [] })
    )

    const response = await server.inject({
      method: 'GET',
      url: '/v1/catch-records?limit=101',
      headers: { authorization: 'Bearer token-1' }
    })

    expect(response.statusCode).toBe(400)
  })

  test('rejects a missing bearer token with 401', async () => {
    const { server } = await createTestServer()

    const response = await server.inject({
      method: 'GET',
      url: '/v1/catch-records'
    })

    expect(response.statusCode).toBe(401)
  })
})

describe('GET /v1/catch-records/{catchRecordId}', () => {
  test('returns the complete canonical record plus derived progress facts', async () => {
    const { server, db } = await createTestServer()
    db.collections['catch-records'].seed(listingDocument())
    fetchMock.mockResponseOnce(
      JSON.stringify({ actorId: 'owner-1', permissions: [] })
    )

    const response = await server.inject({
      method: 'GET',
      url: '/v1/catch-records/record-1',
      headers: { authorization: 'Bearer token-1' }
    })

    expect(response.statusCode).toBe(200)
    const body = JSON.parse(response.payload)
    expect(body.id).toBe('record-1')
    expect(body.catchRecordReference).toBe('GBR-RSS123456-051026-113500')
    expect(body.displayStatus).toBe('Draft')
    expect(body.sectionCompletion).toEqual({
      trip: false,
      pairFishing: true,
      gears: false
    })
    expect([...body.incompleteSections].sort()).toEqual(['gears', 'trip'])
    expect(body.submissionEligible).toBe(false)
    expect(body.progress.allGearsComplete).toBe(false)
  })

  test('returns a safe 404 for a missing record', async () => {
    const { server } = await createTestServer()
    fetchMock.mockResponseOnce(
      JSON.stringify({ actorId: 'owner-1', permissions: [] })
    )

    const response = await server.inject({
      method: 'GET',
      url: '/v1/catch-records/does-not-exist',
      headers: { authorization: 'Bearer token-1' }
    })

    expect(response.statusCode).toBe(404)
  })

  test("returns the identical safe 404 for another owner's record (no existence disclosure)", async () => {
    const { server, db } = await createTestServer()
    db.collections['catch-records'].seed(
      listingDocument({ ownerUserId: 'owner-2' })
    )
    fetchMock.mockResponseOnce(
      JSON.stringify({ actorId: 'owner-1', permissions: [] })
    )

    const response = await server.inject({
      method: 'GET',
      url: '/v1/catch-records/record-1',
      headers: { authorization: 'Bearer token-1' }
    })

    expect(response.statusCode).toBe(404)
  })

  test('rejects a missing bearer token with 401', async () => {
    const { server } = await createTestServer()

    const response = await server.inject({
      method: 'GET',
      url: '/v1/catch-records/record-1'
    })

    expect(response.statusCode).toBe(401)
  })

  test('performs no mutation (no findOneAndUpdate/findOneAndDelete call)', async () => {
    const { server, db } = await createTestServer()
    db.collections['catch-records'].seed(listingDocument())
    fetchMock.mockResponseOnce(
      JSON.stringify({ actorId: 'owner-1', permissions: [] })
    )

    await server.inject({
      method: 'GET',
      url: '/v1/catch-records/record-1',
      headers: { authorization: 'Bearer token-1' }
    })

    expect(
      db.collections['catch-records'].findOneAndUpdate
    ).not.toHaveBeenCalled()
    expect(
      db.collections['catch-records'].findOneAndDelete
    ).not.toHaveBeenCalled()
    expect(
      db.collections['catch-record-history'].insertOne
    ).not.toHaveBeenCalled()
  })
})

function replacementDraftDocument(overrides = {}) {
  return {
    _id: 'record-1',
    schemaVersion: 1,
    catchRecordReference: 'GBR-RSS123456-051026-113500',
    ownerUserId: 'owner-1',
    status: 'DRAFT',
    numberOfSubmissions: 0,
    hasUnsubmittedChanges: false,
    submittedAt: null,
    submittedBy: null,
    completedAt: null,
    completedBy: null,
    artifacts: [],
    version: 1,
    vessel: { id: 'vessel-1' },
    trip: {},
    pairFishing: { enabled: false, pairVessel: null, pairSkipperName: null },
    gears: [],
    speciesNotLanded: [],
    createdAt: '2026-10-05T10:35:00Z',
    createdBy: 'owner-1',
    updatedAt: '2026-10-05T10:35:00Z',
    updatedBy: 'owner-1',
    ...overrides
  }
}

function validReplacementPayload(overrides = {}) {
  return {
    vessel: { id: 'vessel-1' },
    trip: {
      startedAndFinishedToday: false,
      dateStarted: '2026-10-05',
      dateEnded: '2026-10-05',
      departurePort: { id: 'port-1' },
      returnPort: { id: 'port-1' }
    },
    pairFishing: { enabled: false },
    gears: [],
    speciesNotLanded: [],
    ...overrides
  }
}

describe('PUT /v1/catch-records/{catchRecordId}', () => {
  test('replaces the record and returns the standard save response', async () => {
    const { server, db } = await createTestServer()
    db.collections['catch-records'].seed(replacementDraftDocument())
    fetchMock.mockResponseOnce(
      JSON.stringify({ actorId: 'owner-1', permissions: [] })
    )
    fetchMock.mockResponseOnce(JSON.stringify([{ id: 'vessel-1' }]))
    fetchMock.mockResponseOnce(JSON.stringify(validVesselBody()))
    fetchMock.mockResponseOnce(
      JSON.stringify({
        id: 'port-1',
        code: '0349',
        name: 'Plymouth',
        countryCode: 'GB',
        coordinate: null,
        active: true
      })
    )
    fetchMock.mockResponseOnce(
      JSON.stringify({
        id: 'port-1',
        code: '0349',
        name: 'Plymouth',
        countryCode: 'GB',
        coordinate: null,
        active: true
      })
    )

    const response = await server.inject({
      method: 'PUT',
      url: '/v1/catch-records/record-1',
      headers: { authorization: 'Bearer token-1', 'if-match': '1' },
      payload: validReplacementPayload()
    })

    expect(response.statusCode).toBe(200)
    const body = JSON.parse(response.payload)
    expect(body.version).toBe(2)
    expect(body.savedSection).toBeNull()
  })

  test('rejects an unknown root payload property with a safe 400', async () => {
    const { server } = await createTestServer()
    fetchMock.mockResponseOnce(
      JSON.stringify({ actorId: 'owner-1', permissions: [] })
    )

    const response = await server.inject({
      method: 'PUT',
      url: '/v1/catch-records/record-1',
      headers: { authorization: 'Bearer token-1', 'if-match': '1' },
      payload: { ...validReplacementPayload(), status: 'SUBMITTED' }
    })

    expect(response.statusCode).toBe(400)
  })

  test('rejects a missing required section with a safe 400', async () => {
    const { server } = await createTestServer()
    fetchMock.mockResponseOnce(
      JSON.stringify({ actorId: 'owner-1', permissions: [] })
    )
    const { gears: _omitted, ...incompletePayload } = validReplacementPayload()

    const response = await server.inject({
      method: 'PUT',
      url: '/v1/catch-records/record-1',
      headers: { authorization: 'Bearer token-1', 'if-match': '1' },
      payload: incompletePayload
    })

    expect(response.statusCode).toBe(400)
  })

  test('rejects a missing if-match header with a safe 400', async () => {
    const { server } = await createTestServer()
    fetchMock.mockResponseOnce(
      JSON.stringify({ actorId: 'owner-1', permissions: [] })
    )

    const response = await server.inject({
      method: 'PUT',
      url: '/v1/catch-records/record-1',
      headers: { authorization: 'Bearer token-1' },
      payload: validReplacementPayload()
    })

    expect(response.statusCode).toBe(400)
  })

  test('returns a deterministic 409 for a stale expected version', async () => {
    const { server, db } = await createTestServer()
    db.collections['catch-records'].seed(
      replacementDraftDocument({ version: 2 })
    )
    fetchMock.mockResponseOnce(
      JSON.stringify({ actorId: 'owner-1', permissions: [] })
    )
    fetchMock.mockResponseOnce(JSON.stringify([{ id: 'vessel-1' }]))
    fetchMock.mockResponseOnce(JSON.stringify(validVesselBody()))
    fetchMock.mockResponseOnce(
      JSON.stringify({
        id: 'port-1',
        code: '0349',
        name: 'Plymouth',
        countryCode: 'GB',
        coordinate: null,
        active: true
      })
    )
    fetchMock.mockResponseOnce(
      JSON.stringify({
        id: 'port-1',
        code: '0349',
        name: 'Plymouth',
        countryCode: 'GB',
        coordinate: null,
        active: true
      })
    )

    const response = await server.inject({
      method: 'PUT',
      url: '/v1/catch-records/record-1',
      headers: { authorization: 'Bearer token-1', 'if-match': '1' },
      payload: validReplacementPayload()
    })

    expect(response.statusCode).toBe(409)
    expect(
      db.collections['catch-record-history'].insertOne
    ).not.toHaveBeenCalled()
  })

  test('returns 409 for a SUBMITTED record without any reference-data call', async () => {
    const { server, db } = await createTestServer()
    db.collections['catch-records'].seed(
      replacementDraftDocument({ status: 'SUBMITTED', numberOfSubmissions: 1 })
    )
    fetchMock.mockResponseOnce(
      JSON.stringify({ actorId: 'owner-1', permissions: [] })
    )

    const response = await server.inject({
      method: 'PUT',
      url: '/v1/catch-records/record-1',
      headers: { authorization: 'Bearer token-1', 'if-match': '1' },
      payload: validReplacementPayload()
    })

    expect(response.statusCode).toBe(409)
    expect(fetchMock.mock.calls).toHaveLength(1)
  })

  test('returns a safe 404 for a missing record', async () => {
    const { server } = await createTestServer()
    fetchMock.mockResponseOnce(
      JSON.stringify({ actorId: 'owner-1', permissions: [] })
    )

    const response = await server.inject({
      method: 'PUT',
      url: '/v1/catch-records/does-not-exist',
      headers: { authorization: 'Bearer token-1', 'if-match': '1' },
      payload: validReplacementPayload()
    })

    expect(response.statusCode).toBe(404)
  })

  test('rejects a missing bearer token with 401', async () => {
    const { server } = await createTestServer()

    const response = await server.inject({
      method: 'PUT',
      url: '/v1/catch-records/record-1',
      headers: { 'if-match': '1' },
      payload: validReplacementPayload()
    })

    expect(response.statusCode).toBe(401)
  })

  test('rejects an oversized payload with a safe error', async () => {
    const { server } = await createTestServer()
    fetchMock.mockResponseOnce(
      JSON.stringify({ actorId: 'owner-1', permissions: [] })
    )

    const oversizedSpeciesNotLanded = Array.from({ length: 20000 }, () => ({
      id: 'COD',
      weightAboveMinimumKg: 1,
      note: 'x'.repeat(200)
    }))

    const response = await server.inject({
      method: 'PUT',
      url: '/v1/catch-records/record-1',
      headers: { authorization: 'Bearer token-1', 'if-match': '1' },
      payload: validReplacementPayload({
        speciesNotLanded: oversizedSpeciesNotLanded
      })
    })

    expect(response.statusCode).toBe(413)
  })
})

function historyEventDocument(overrides = {}) {
  return {
    _id: 'event-1',
    catchRecordId: 'record-1',
    ownerUserId: 'owner-1',
    eventType: 'DRAFT_CREATED',
    timestamp: '2026-10-05T10:35:00Z',
    actorUserId: 'owner-1',
    ...overrides
  }
}

describe('GET /v1/catch-records/{catchRecordId}/history', () => {
  test('returns the combined lifecycle and audit history', async () => {
    const { server, db } = await createTestServer()
    db.collections['catch-records'].seed(listingDocument())
    db.collections['catch-record-history'].seed(historyEventDocument())
    db.collections['catch-record-history'].seed(
      historyEventDocument({
        _id: 'event-2',
        eventType: 'SECTION_SAVED',
        timestamp: '2026-10-05T11:00:00Z',
        metadata: { section: 'trip' }
      })
    )
    fetchMock.mockResponseOnce(
      JSON.stringify({ actorId: 'owner-1', permissions: [] })
    )

    const response = await server.inject({
      method: 'GET',
      url: '/v1/catch-records/record-1/history',
      headers: { authorization: 'Bearer token-1' }
    })

    expect(response.statusCode).toBe(200)
    const body = JSON.parse(response.payload)
    expect(body.catchRecordId).toBe('record-1')
    expect(body.events).toHaveLength(2)
    expect(body.events[0].eventType).toBe('DRAFT_CREATED')
    expect(body.events[1].section).toBe('trip')
  })

  test('returns a successful empty history for a record with no events', async () => {
    const { server, db } = await createTestServer()
    db.collections['catch-records'].seed(listingDocument())
    fetchMock.mockResponseOnce(
      JSON.stringify({ actorId: 'owner-1', permissions: [] })
    )

    const response = await server.inject({
      method: 'GET',
      url: '/v1/catch-records/record-1/history',
      headers: { authorization: 'Bearer token-1' }
    })

    expect(response.statusCode).toBe(200)
    expect(JSON.parse(response.payload).events).toEqual([])
  })

  test('returns a safe 404 for a missing record', async () => {
    const { server } = await createTestServer()
    fetchMock.mockResponseOnce(
      JSON.stringify({ actorId: 'owner-1', permissions: [] })
    )

    const response = await server.inject({
      method: 'GET',
      url: '/v1/catch-records/does-not-exist/history',
      headers: { authorization: 'Bearer token-1' }
    })

    expect(response.statusCode).toBe(404)
  })

  test("returns the identical safe 404 for another owner's record", async () => {
    const { server, db } = await createTestServer()
    db.collections['catch-records'].seed(
      listingDocument({ ownerUserId: 'owner-2' })
    )
    fetchMock.mockResponseOnce(
      JSON.stringify({ actorId: 'owner-1', permissions: [] })
    )

    const response = await server.inject({
      method: 'GET',
      url: '/v1/catch-records/record-1/history',
      headers: { authorization: 'Bearer token-1' }
    })

    expect(response.statusCode).toBe(404)
  })

  test('rejects a limit above the approved maximum with a safe 400', async () => {
    const { server } = await createTestServer()
    fetchMock.mockResponseOnce(
      JSON.stringify({ actorId: 'owner-1', permissions: [] })
    )

    const response = await server.inject({
      method: 'GET',
      url: '/v1/catch-records/record-1/history?limit=101',
      headers: { authorization: 'Bearer token-1' }
    })

    expect(response.statusCode).toBe(400)
  })

  test('rejects an unknown query parameter with a safe 400', async () => {
    const { server } = await createTestServer()
    fetchMock.mockResponseOnce(
      JSON.stringify({ actorId: 'owner-1', permissions: [] })
    )

    const response = await server.inject({
      method: 'GET',
      url: '/v1/catch-records/record-1/history?offset=5',
      headers: { authorization: 'Bearer token-1' }
    })

    expect(response.statusCode).toBe(400)
  })

  test('rejects a missing bearer token with 401', async () => {
    const { server } = await createTestServer()

    const response = await server.inject({
      method: 'GET',
      url: '/v1/catch-records/record-1/history'
    })

    expect(response.statusCode).toBe(401)
  })

  test('performs no mutation and creates no additional history event', async () => {
    const { server, db } = await createTestServer()
    db.collections['catch-records'].seed(listingDocument())
    fetchMock.mockResponseOnce(
      JSON.stringify({ actorId: 'owner-1', permissions: [] })
    )

    await server.inject({
      method: 'GET',
      url: '/v1/catch-records/record-1/history',
      headers: { authorization: 'Bearer token-1' }
    })

    expect(
      db.collections['catch-records'].findOneAndUpdate
    ).not.toHaveBeenCalled()
    expect(
      db.collections['catch-record-history'].insertOne
    ).not.toHaveBeenCalled()
  })
})
