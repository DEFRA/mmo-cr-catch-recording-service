import { startCatchRecordEdit } from './start-catch-record-edit.js'
import { toPersistenceDocument } from '#/catch-recording/persistence/catch-record-mapper.js'
import { computeRequestFingerprint } from '#/catch-recording/persistence/idempotency-fingerprint.js'
import { isApplicationError } from '#/common/helpers/errors/application-error.js'
import {
  submittedExample,
  completeExample,
  newDraftExample,
  amendedDraftExample
} from '#/catch-recording/domain/__fixtures__/canonical-catch-record.fixtures.js'

const OWNER_USER_ID = submittedExample.ownerUserId

function matchesFilterValue(documentValue, filterValue) {
  if (
    filterValue &&
    typeof filterValue === 'object' &&
    Array.isArray(filterValue.$in)
  ) {
    return filterValue.$in.includes(documentValue)
  }
  return documentValue === filterValue
}

function matchesFilter(document, filter) {
  return Object.entries(filter).every(([key, value]) =>
    matchesFilterValue(document[key], value)
  )
}

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
        if (matchesFilter(document, filter)) {
          return document
        }
      }
      return null
    }),
    findOneAndUpdate: vi.fn(async (filter, update) => {
      for (const [id, document] of store.entries()) {
        if (matchesFilter(document, filter)) {
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

function authenticationContext(userId = OWNER_USER_ID) {
  return Object.freeze({ userId, scopes: Object.freeze([]) })
}

describe('#startCatchRecordEdit', () => {
  test('Should return an eligible submitted record to DRAFT with hasUnsubmittedChanges = true', async () => {
    const db = buildFakeDb()
    seedCatchRecord(db, submittedExample)

    const response = await startCatchRecordEdit({
      db,
      authenticationContext: authenticationContext(),
      catchRecordId: submittedExample.id,
      expectedVersion: submittedExample.version
    })

    expect(response.status).toBe('DRAFT')
    expect(response.displayStatus).toBe('Amended')
    expect(response.version).toBe(submittedExample.version + 1)
    expect(response.progress.hasUnsubmittedChanges).toBe(true)
    expect(response.progress.numberOfSubmissions).toBe(
      submittedExample.numberOfSubmissions
    )

    const historyInsert =
      db.collections['catch-record-history'].insertOne.mock.calls[0][0]
    expect(historyInsert.eventType).toBe('EDIT_STARTED')
  })

  test('Should also accept an eligible COMPLETE record', async () => {
    const db = buildFakeDb()
    seedCatchRecord(db, completeExample)

    const response = await startCatchRecordEdit({
      db,
      authenticationContext: authenticationContext(completeExample.ownerUserId),
      catchRecordId: completeExample.id,
      expectedVersion: completeExample.version
    })

    expect(response.status).toBe('DRAFT')
    expect(response.progress.hasUnsubmittedChanges).toBe(true)
  })

  test('Should preserve the catch record id, friendly reference, submission count, and artifacts', async () => {
    const db = buildFakeDb()
    seedCatchRecord(db, submittedExample)

    const response = await startCatchRecordEdit({
      db,
      authenticationContext: authenticationContext(),
      catchRecordId: submittedExample.id,
      expectedVersion: submittedExample.version
    })

    expect(response.id).toBe(submittedExample.id)
    expect(response.catchRecordReference).toBe(
      submittedExample.catchRecordReference
    )

    const storedDocument = db.collections['catch-records'].store.get(
      submittedExample.id
    )
    expect(storedDocument.artifacts).toEqual(submittedExample.artifacts)
    expect(storedDocument.numberOfSubmissions).toBe(
      submittedExample.numberOfSubmissions
    )
  })

  test('Should reject an already-DRAFT record (never-submitted)', async () => {
    const db = buildFakeDb()
    seedCatchRecord(db, newDraftExample)

    await expect(
      startCatchRecordEdit({
        db,
        authenticationContext: authenticationContext(),
        catchRecordId: newDraftExample.id,
        expectedVersion: newDraftExample.version
      })
    ).rejects.toMatchObject({
      category: 'INVALID_LIFECYCLE_TRANSITION',
      code: 'CATCH_RECORD_EDIT_START_INELIGIBLE'
    })
  })

  test('Should reject an already-DRAFT amended record', async () => {
    const db = buildFakeDb()
    seedCatchRecord(db, amendedDraftExample)

    await expect(
      startCatchRecordEdit({
        db,
        authenticationContext: authenticationContext(),
        catchRecordId: amendedDraftExample.id,
        expectedVersion: amendedDraftExample.version
      })
    ).rejects.toMatchObject({ code: 'CATCH_RECORD_EDIT_START_INELIGIBLE' })
  })

  test('Should reject a stale expected version with VERSION_CONFLICT', async () => {
    const db = buildFakeDb()
    seedCatchRecord(db, submittedExample)

    await expect(
      startCatchRecordEdit({
        db,
        authenticationContext: authenticationContext(),
        catchRecordId: submittedExample.id,
        expectedVersion: submittedExample.version + 5
      })
    ).rejects.toMatchObject({ category: 'VERSION_CONFLICT' })
  })

  test('Should reject a missing catch record', async () => {
    const db = buildFakeDb()

    await expect(
      startCatchRecordEdit({
        db,
        authenticationContext: authenticationContext(),
        catchRecordId: 'does-not-exist',
        expectedVersion: 1
      })
    ).rejects.toMatchObject({ category: 'RESOURCE_NOT_FOUND' })
  })

  test('Should reject a horizontal edit-start attempt by a different owner as not found', async () => {
    const db = buildFakeDb()
    seedCatchRecord(db, submittedExample)

    await expect(
      startCatchRecordEdit({
        db,
        authenticationContext: authenticationContext('a-different-owner'),
        catchRecordId: submittedExample.id,
        expectedVersion: submittedExample.version
      })
    ).rejects.toMatchObject({ category: 'RESOURCE_NOT_FOUND' })
  })

  test('Should replay the stored result for a repeated idempotency key without re-incrementing the version', async () => {
    const db = buildFakeDb()
    seedCatchRecord(db, submittedExample)
    const idempotencyKey = 'retry-key'

    const first = await startCatchRecordEdit({
      db,
      authenticationContext: authenticationContext(),
      catchRecordId: submittedExample.id,
      expectedVersion: submittedExample.version,
      idempotencyKey
    })

    const second = await startCatchRecordEdit({
      db,
      authenticationContext: authenticationContext(),
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
      operationScope: 'EDIT_START',
      idempotencyKey,
      allowedFields: ['expectedVersion'],
      semanticInput: { expectedVersion: submittedExample.version }
    })
    db.collections['catch-idempotency-claims'].store.set('pending-claim', {
      _id: 'pending-claim',
      ownerUserId: OWNER_USER_ID,
      operationScope: 'EDIT_START',
      idempotencyKey,
      resourceId: submittedExample.id,
      fingerprint,
      state: 'PENDING',
      createdAt: new Date().toISOString()
    })

    await expect(
      startCatchRecordEdit({
        db,
        authenticationContext: authenticationContext(),
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
      startCatchRecordEdit({
        db,
        authenticationContext: authenticationContext(),
        catchRecordId: 'does-not-exist',
        expectedVersion: 1
      })
    ).rejects.toSatisfy(isApplicationError)
  })
})
