import { completeCatchRecord } from './complete-catch-record.js'
import { toPersistenceDocument } from '#/catch-recording/persistence/catch-record-mapper.js'
import { computeRequestFingerprint } from '#/catch-recording/persistence/idempotency-fingerprint.js'
import { isApplicationError } from '#/common/helpers/errors/application-error.js'
import {
  submittedExample,
  newDraftExample,
  completeExample
} from '#/catch-recording/domain/__fixtures__/canonical-catch-record.fixtures.js'

const COMPLETION_SCOPE = 'catch-recording.complete'
const ADMIN_USER_ID = 'admin-1'

function buildFakeCollection({ uniqueIndexFields } = {}) {
  const store = new Map()
  let nextId = 1
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
      const id = document._id ?? `generated-${nextId++}`
      store.set(id, { ...document, _id: id })
      return { acknowledged: true, insertedId: id }
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
    store
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

  return { collection: vi.fn((name) => collections[name]), collections }
}

function seedCatchRecord(db, fixture) {
  db.collections['catch-records'].store.set(
    fixture.id,
    toPersistenceDocument(fixture)
  )
}

function adminAuthenticationContext(scopes = [COMPLETION_SCOPE]) {
  return Object.freeze({ userId: ADMIN_USER_ID, scopes: Object.freeze(scopes) })
}

describe('#completeCatchRecord', () => {
  test('Should complete an eligible submitted record', async () => {
    const db = buildFakeDb()
    seedCatchRecord(db, submittedExample)

    const response = await completeCatchRecord({
      db,
      authenticationContext: adminAuthenticationContext(),
      catchRecordId: submittedExample.id,
      expectedVersion: submittedExample.version
    })

    expect(response.status).toBe('COMPLETE')
    expect(response.displayStatus).toBe('Complete')
    expect(response.version).toBe(submittedExample.version + 1)
    expect(response.completedAt).toEqual(expect.any(String))
    expect(response.completedBy).toBe(ADMIN_USER_ID)

    const historyInsert =
      db.collections['catch-record-history'].insertOne.mock.calls[0][0]
    expect(historyInsert.eventType).toBe('COMPLETED')
    expect(historyInsert.ownerUserId).toBe(submittedExample.ownerUserId)
    expect(historyInsert.actorUserId).toBe(ADMIN_USER_ID)
  })

  test('Should complete a record regardless of the acting administrator not being its owner (purely permission-gated)', async () => {
    const db = buildFakeDb()
    seedCatchRecord(db, submittedExample)

    const response = await completeCatchRecord({
      db,
      authenticationContext: adminAuthenticationContext(),
      catchRecordId: submittedExample.id,
      expectedVersion: submittedExample.version
    })

    expect(response.status).toBe('COMPLETE')
    expect(ADMIN_USER_ID).not.toBe(submittedExample.ownerUserId)
  })

  test('Should reject an authenticated caller lacking the exact completion scope', async () => {
    const db = buildFakeDb()
    seedCatchRecord(db, submittedExample)

    await expect(
      completeCatchRecord({
        db,
        authenticationContext: adminAuthenticationContext([]),
        catchRecordId: submittedExample.id,
        expectedVersion: submittedExample.version
      })
    ).rejects.toMatchObject({ category: 'AUTHORISATION_FAILURE' })
  })

  test('Should reject an unauthenticated caller', async () => {
    const db = buildFakeDb()
    seedCatchRecord(db, submittedExample)

    await expect(
      completeCatchRecord({
        db,
        authenticationContext: { userId: undefined, scopes: [] },
        catchRecordId: submittedExample.id,
        expectedVersion: submittedExample.version
      })
    ).rejects.toMatchObject({ category: 'AUTHENTICATION_FAILURE' })
  })

  test('Should reject a DRAFT record (not eligible for completion)', async () => {
    const db = buildFakeDb()
    seedCatchRecord(db, newDraftExample)

    await expect(
      completeCatchRecord({
        db,
        authenticationContext: adminAuthenticationContext(),
        catchRecordId: newDraftExample.id,
        expectedVersion: newDraftExample.version
      })
    ).rejects.toMatchObject({
      category: 'INVALID_LIFECYCLE_TRANSITION',
      code: 'CATCH_RECORD_COMPLETION_INELIGIBLE'
    })
  })

  test('Should reject an already-COMPLETE record', async () => {
    const db = buildFakeDb()
    seedCatchRecord(db, completeExample)

    await expect(
      completeCatchRecord({
        db,
        authenticationContext: adminAuthenticationContext(),
        catchRecordId: completeExample.id,
        expectedVersion: completeExample.version
      })
    ).rejects.toMatchObject({ code: 'CATCH_RECORD_COMPLETION_INELIGIBLE' })
  })

  test('Should reject a stale expected version with VERSION_CONFLICT', async () => {
    const db = buildFakeDb()
    seedCatchRecord(db, submittedExample)

    await expect(
      completeCatchRecord({
        db,
        authenticationContext: adminAuthenticationContext(),
        catchRecordId: submittedExample.id,
        expectedVersion: submittedExample.version + 5
      })
    ).rejects.toMatchObject({ category: 'VERSION_CONFLICT' })
  })

  test('Should reject a missing catch record', async () => {
    const db = buildFakeDb()

    await expect(
      completeCatchRecord({
        db,
        authenticationContext: adminAuthenticationContext(),
        catchRecordId: 'does-not-exist',
        expectedVersion: 1
      })
    ).rejects.toMatchObject({ category: 'RESOURCE_NOT_FOUND' })
  })

  test('Should replay the stored result for a repeated idempotency key without re-incrementing the version', async () => {
    const db = buildFakeDb()
    seedCatchRecord(db, submittedExample)
    const idempotencyKey = 'retry-key'

    const first = await completeCatchRecord({
      db,
      authenticationContext: adminAuthenticationContext(),
      catchRecordId: submittedExample.id,
      expectedVersion: submittedExample.version,
      idempotencyKey
    })

    const second = await completeCatchRecord({
      db,
      authenticationContext: adminAuthenticationContext(),
      catchRecordId: submittedExample.id,
      expectedVersion: submittedExample.version,
      idempotencyKey
    })

    expect(second).toEqual(first)
  })

  test('Should reject a concurrent duplicate request for the same idempotency key as IN_PROGRESS', async () => {
    const db = buildFakeDb()
    seedCatchRecord(db, submittedExample)
    const idempotencyKey = 'concurrent-key'

    const fingerprint = computeRequestFingerprint({
      operationScope: 'COMPLETION',
      idempotencyKey,
      allowedFields: ['expectedVersion'],
      semanticInput: { expectedVersion: submittedExample.version }
    })
    db.collections['catch-idempotency-claims'].store.set('pending-claim', {
      _id: 'pending-claim',
      ownerUserId: ADMIN_USER_ID,
      operationScope: 'COMPLETION',
      idempotencyKey,
      resourceId: submittedExample.id,
      fingerprint,
      state: 'PENDING',
      createdAt: new Date().toISOString()
    })

    await expect(
      completeCatchRecord({
        db,
        authenticationContext: adminAuthenticationContext(),
        catchRecordId: submittedExample.id,
        expectedVersion: submittedExample.version,
        idempotencyKey
      })
    ).rejects.toMatchObject({
      category: 'IDEMPOTENCY_CONFLICT',
      code: 'IDEMPOTENCY_REQUEST_IN_PROGRESS'
    })
  })

  test('Should satisfy isApplicationError for every thrown error', async () => {
    const db = buildFakeDb()

    await expect(
      completeCatchRecord({
        db,
        authenticationContext: adminAuthenticationContext(),
        catchRecordId: 'does-not-exist',
        expectedVersion: 1
      })
    ).rejects.toSatisfy(isApplicationError)
  })
})
