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
      createIndex: vi.fn(),
      seed: (document) => store.set(document._id, document)
    },
    'catch-record-history': {
      insertOne: vi.fn(async (document) => ({
        acknowledged: true,
        insertedId: 'history-1',
        ...document
      })),
      createIndex: vi.fn()
    }
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
