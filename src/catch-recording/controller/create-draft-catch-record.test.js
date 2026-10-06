import { randomUUID } from 'node:crypto'

import { createDraftCatchRecord } from './create-draft-catch-record.js'
import { isApplicationError } from '#/common/helpers/errors/application-error.js'

const OWNER_USER_ID = 'owner-1'
const VESSEL_ID = 'vessel-1'

function buildFakeCollection({ uniqueIndexFields } = {}) {
  const store = new Map()
  return {
    insertOne: vi.fn(async (document) => {
      if (uniqueIndexFields) {
        for (const existing of store.values()) {
          const isDuplicate = uniqueIndexFields.every(
            (field) => existing[field] === document[field]
          )
          if (isDuplicate) {
            const error = new Error('E11000 duplicate key error')
            error.code = 11000
            throw error
          }
        }
      }

      const id = document._id ?? randomUUID()
      store.set(id, { ...document, _id: id })
      return { acknowledged: true, insertedId: id }
    }),
    findOne: vi.fn(async (filter) => {
      for (const document of store.values()) {
        const matches = Object.entries(filter).every(
          ([key, value]) => document[key] === value
        )
        if (matches) {
          return document
        }
      }
      return null
    }),
    findOneAndUpdate: vi.fn(async (filter, update) => {
      for (const [id, document] of store.entries()) {
        const matches = Object.entries(filter).every(
          ([key, value]) => document[key] === value
        )
        if (matches) {
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
    createIndex: vi.fn()
  }
}

function buildFakeDb() {
  const collections = {
    'catch-records': buildFakeCollection(),
    'catch-record-history': buildFakeCollection(),
    'catch-idempotency-claims': buildFakeCollection({
      uniqueIndexFields: [
        'ownerUserId',
        'operationScope',
        'idempotencyKey',
        'resourceId'
      ]
    })
  }

  return {
    collection: vi.fn((name) => collections[name]),
    collections
  }
}

function fakeReferenceDataClient({
  rssSnapshot = 'RSS123456',
  accessibleVesselIds = [VESSEL_ID]
} = {}) {
  return {
    listAccessibleVesselIds: vi.fn(async () => accessibleVesselIds),
    getVesselById: vi.fn(async (id) => ({
      id,
      status: 'active',
      name: 'Example Vessel',
      lengthOverallMetres: 9.5,
      identifiers: { registrationNumber: rssSnapshot, externalMark: 'PZ1' }
    }))
  }
}

function authenticationContext(userId = OWNER_USER_ID) {
  return Object.freeze({ userId, scopes: Object.freeze([]) })
}

describe('#createDraftCatchRecord', () => {
  test('creates a DRAFT with trusted owner metadata and the generated friendly reference', async () => {
    const db = buildFakeDb()

    const response = await createDraftCatchRecord({
      db,
      referenceDataClient: fakeReferenceDataClient(),
      authenticationContext: authenticationContext(),
      vesselId: VESSEL_ID,
      idempotencyKey: undefined,
      businessTimezone: 'Europe/London'
    })

    expect(response.status).toBe('DRAFT')
    expect(response.displayStatus).toBe('Draft')
    expect(response.version).toBe(1)
    expect(response.catchRecordReference).toMatch(/^GBR-RSS123456-\d{6}-\d{6}$/)

    const stored = db.collections['catch-records'].insertOne.mock.calls[0][0]
    expect(stored.ownerUserId).toBe(OWNER_USER_ID)
    expect(stored.createdBy).toBe(OWNER_USER_ID)
    expect(stored.status).toBe('DRAFT')
    expect(stored.numberOfSubmissions).toBe(0)
  })

  test('appends a DRAFT_CREATED history event', async () => {
    const db = buildFakeDb()

    await createDraftCatchRecord({
      db,
      referenceDataClient: fakeReferenceDataClient(),
      authenticationContext: authenticationContext(),
      vesselId: VESSEL_ID,
      businessTimezone: 'Europe/London'
    })

    const historyInsert =
      db.collections['catch-record-history'].insertOne.mock.calls[0][0]
    expect(historyInsert.eventType).toBe('DRAFT_CREATED')
    expect(historyInsert.ownerUserId).toBe(OWNER_USER_ID)
  })

  test('rejects a missing vesselId', async () => {
    const db = buildFakeDb()

    await expect(
      createDraftCatchRecord({
        db,
        referenceDataClient: fakeReferenceDataClient(),
        authenticationContext: authenticationContext(),
        vesselId: undefined,
        businessTimezone: 'Europe/London'
      })
    ).rejects.toSatisfy(isApplicationError)

    expect(db.collections['catch-records'].insertOne).not.toHaveBeenCalled()
  })

  test('rejects a vessel the caller cannot access', async () => {
    const db = buildFakeDb()

    await expect(
      createDraftCatchRecord({
        db,
        referenceDataClient: fakeReferenceDataClient({
          accessibleVesselIds: ['some-other-vessel']
        }),
        authenticationContext: authenticationContext(),
        vesselId: VESSEL_ID,
        businessTimezone: 'Europe/London'
      })
    ).rejects.toMatchObject({ category: 'AUTHORISATION_FAILURE' })

    expect(db.collections['catch-records'].insertOne).not.toHaveBeenCalled()
  })

  test('rejects a vessel with a missing RSS before creating anything', async () => {
    const db = buildFakeDb()

    await expect(
      createDraftCatchRecord({
        db,
        referenceDataClient: fakeReferenceDataClient({ rssSnapshot: null }),
        authenticationContext: authenticationContext(),
        vesselId: VESSEL_ID,
        businessTimezone: 'Europe/London'
      })
    ).rejects.toMatchObject({ code: 'VESSEL_RSS_MISSING' })

    expect(db.collections['catch-records'].insertOne).not.toHaveBeenCalled()
  })

  test('never trusts a client-supplied owner or audit value', async () => {
    const db = buildFakeDb()

    await createDraftCatchRecord({
      db,
      referenceDataClient: fakeReferenceDataClient(),
      authenticationContext: authenticationContext(),
      vesselId: VESSEL_ID,
      ownerUserId: 'attacker-supplied-id',
      createdBy: 'attacker-supplied-id',
      businessTimezone: 'Europe/London'
    })

    const stored = db.collections['catch-records'].insertOne.mock.calls[0][0]
    expect(stored.ownerUserId).toBe(OWNER_USER_ID)
  })

  test('replays the same result for a repeated request with the same idempotency key', async () => {
    const db = buildFakeDb()
    const referenceDataClient = fakeReferenceDataClient()

    const first = await createDraftCatchRecord({
      db,
      referenceDataClient,
      authenticationContext: authenticationContext(),
      vesselId: VESSEL_ID,
      idempotencyKey: 'key-1',
      businessTimezone: 'Europe/London'
    })

    const second = await createDraftCatchRecord({
      db,
      referenceDataClient,
      authenticationContext: authenticationContext(),
      vesselId: VESSEL_ID,
      idempotencyKey: 'key-1',
      businessTimezone: 'Europe/London'
    })

    expect(second.id).toBe(first.id)
    expect(second.catchRecordReference).toBe(first.catchRecordReference)
    expect(db.collections['catch-records'].insertOne).toHaveBeenCalledTimes(1)
  })

  test('rejects a reused idempotency key with a different vessel selection', async () => {
    const db = buildFakeDb()
    const referenceDataClient = fakeReferenceDataClient({
      accessibleVesselIds: [VESSEL_ID, 'vessel-2']
    })

    await createDraftCatchRecord({
      db,
      referenceDataClient,
      authenticationContext: authenticationContext(),
      vesselId: VESSEL_ID,
      idempotencyKey: 'key-1',
      businessTimezone: 'Europe/London'
    })

    await expect(
      createDraftCatchRecord({
        db,
        referenceDataClient,
        authenticationContext: authenticationContext(),
        vesselId: 'vessel-2',
        idempotencyKey: 'key-1',
        businessTimezone: 'Europe/London'
      })
    ).rejects.toMatchObject({ category: 'IDEMPOTENCY_CONFLICT' })
  })
})
