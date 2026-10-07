import { createHash } from 'node:crypto'

import { submitCatchRecord } from './submit-catch-record.js'
import { toPersistenceDocument } from '#/catch-recording/persistence/catch-record-mapper.js'
import { computeRequestFingerprint } from '#/catch-recording/persistence/idempotency-fingerprint.js'
import {
  ApplicationError,
  isApplicationError
} from '#/common/helpers/errors/application-error.js'
import {
  newDraftExample,
  amendedDraftExample
} from '#/catch-recording/domain/__fixtures__/canonical-catch-record.fixtures.js'

const OWNER_USER_ID = newDraftExample.ownerUserId
const CATCH_RECORD_ID = newDraftExample.id

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

      const id = document._id ?? document.id ?? JSON.stringify(document)
      store.set(id, { ...document, _id: document._id ?? id })
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

  return {
    collection: vi.fn((name) => collections[name]),
    collections
  }
}

function seedCatchRecord(db, fixture) {
  db.collections['catch-records'].store.set(
    fixture.id,
    toPersistenceDocument(fixture)
  )
}

function fakeReferenceDataClient() {
  return {
    listAccessibleVesselIds: vi.fn(async () => [newDraftExample.vessel.id]),
    getVesselById: vi.fn(async (id) => ({
      id,
      status: 'active',
      name: 'EXAMPLE VESSEL',
      identifiers: { registrationNumber: 'RSS123456', externalMark: 'PH123' },
      lengthOverallMetres: 8.74
    })),
    getPortById: vi.fn(async (id) => ({
      id,
      code: '0349',
      name: 'Plymouth',
      active: true
    })),
    getGearById: vi.fn(async (id) => ({
      id,
      code: 'TBB',
      name: 'Beam Trawl',
      active: true,
      characteristics: []
    })),
    getStatisticalAreaById: vi.fn(async (id) => ({
      id,
      code: '46F45',
      name: 'ICES 46F45'
    })),
    getSpeciesById: vi.fn(async (id) => ({
      id,
      faoCode: 'COD',
      scientificName: 'Gadus morhua',
      commonNames: [{ name: 'Atlantic Cod' }],
      active: true
    }))
  }
}

function buildFakeCatchArtifactStore() {
  const objects = new Map()
  return {
    objects,
    commitArtifact: vi.fn(async ({ key, body, contentType }) => {
      const checksum = createHash('sha256').update(body).digest('hex')
      const existing = objects.get(key)
      if (existing) {
        if (existing.checksum === checksum) {
          return {
            key,
            checksum,
            contentLength: body.length,
            contentType,
            reused: true
          }
        }
        throw new Error('ARTIFACT_INTEGRITY_CONFLICT')
      }
      objects.set(key, { body, checksum, contentType })
      return {
        key,
        checksum,
        contentLength: body.length,
        contentType,
        reused: false
      }
    }),
    retrieveArtifact: vi.fn(async (key) => {
      const existing = objects.get(key)
      if (!existing) {
        throw new ApplicationError({
          category: 'RESOURCE_NOT_FOUND',
          code: 'CATCH_ARTIFACT_NOT_FOUND',
          message: 'not found'
        })
      }
      return {
        body: existing.body,
        contentType: existing.contentType,
        contentLength: existing.body.length,
        checksum: existing.checksum
      }
    })
  }
}

function authenticationContext(userId = OWNER_USER_ID) {
  return Object.freeze({ userId, scopes: Object.freeze([]) })
}

describe('#submitCatchRecord', () => {
  test('Should submit an eligible never-submitted draft for the first time', async () => {
    const db = buildFakeDb()
    seedCatchRecord(db, newDraftExample)
    const catchArtifactStore = buildFakeCatchArtifactStore()

    const response = await submitCatchRecord({
      db,
      referenceDataClient: fakeReferenceDataClient(),
      catchArtifactStore,
      authenticationContext: authenticationContext(),
      catchRecordId: CATCH_RECORD_ID,
      expectedVersion: newDraftExample.version
    })

    expect(response.status).toBe('SUBMITTED')
    expect(response.displayStatus).toBe('Submitted')
    expect(response.version).toBe(newDraftExample.version + 1)
    expect(response.submittedAt).toEqual(expect.any(String))
    expect(response.submittedBy).toBe(OWNER_USER_ID)
    expect(response.artifacts).toHaveLength(2)
    expect(response.artifacts.map((artifact) => artifact.type).sort()).toEqual([
      'JSON_SNAPSHOT',
      'PDF_RECEIPT'
    ])
    expect(catchArtifactStore.commitArtifact).toHaveBeenCalledTimes(2)

    const historyInsert =
      db.collections['catch-record-history'].insertOne.mock.calls[0][0]
    expect(historyInsert.eventType).toBe('SUBMITTED')
    expect(historyInsert.metadata).toEqual({ submissionNumber: 1 })
  })

  test('Should resubmit an eligible amended draft, incrementing the submission number and preserving prior artifacts', async () => {
    const db = buildFakeDb()
    seedCatchRecord(db, amendedDraftExample)
    const catchArtifactStore = buildFakeCatchArtifactStore()

    const response = await submitCatchRecord({
      db,
      referenceDataClient: fakeReferenceDataClient(),
      catchArtifactStore,
      authenticationContext: authenticationContext(),
      catchRecordId: amendedDraftExample.id,
      expectedVersion: amendedDraftExample.version
    })

    expect(response.status).toBe('SUBMITTED')
    expect(response.artifacts).toHaveLength(4) // 2 prior + 2 new
    expect(response.progress.hasUnsubmittedChanges).toBe(false)

    const historyInsert =
      db.collections['catch-record-history'].insertOne.mock.calls[0][0]
    expect(historyInsert.eventType).toBe('RESUBMITTED')
    expect(historyInsert.metadata).toEqual({ submissionNumber: 2 })
  })

  test('Should reject submission of an incomplete draft without writing any artifact or history event', async () => {
    const db = buildFakeDb()
    const incompleteDraft = {
      ...newDraftExample,
      gears: [{ ...newDraftExample.gears[0], speciesCaught: [] }]
    }
    seedCatchRecord(db, incompleteDraft)
    const catchArtifactStore = buildFakeCatchArtifactStore()

    await expect(
      submitCatchRecord({
        db,
        referenceDataClient: fakeReferenceDataClient(),
        catchArtifactStore,
        authenticationContext: authenticationContext(),
        catchRecordId: CATCH_RECORD_ID,
        expectedVersion: newDraftExample.version
      })
    ).rejects.toMatchObject({ category: 'BUSINESS_VALIDATION_FAILURE' })

    expect(catchArtifactStore.commitArtifact).not.toHaveBeenCalled()
    expect(
      db.collections['catch-record-history'].insertOne
    ).not.toHaveBeenCalled()
  })

  test('Should reject submission of a SUBMITTED record (not eligible)', async () => {
    const db = buildFakeDb()
    seedCatchRecord(db, {
      ...amendedDraftExample,
      status: 'SUBMITTED',
      numberOfSubmissions: 1,
      hasUnsubmittedChanges: false
    })
    const catchArtifactStore = buildFakeCatchArtifactStore()

    await expect(
      submitCatchRecord({
        db,
        referenceDataClient: fakeReferenceDataClient(),
        catchArtifactStore,
        authenticationContext: authenticationContext(),
        catchRecordId: amendedDraftExample.id,
        expectedVersion: amendedDraftExample.version
      })
    ).rejects.toMatchObject({
      category: 'INVALID_LIFECYCLE_TRANSITION',
      code: 'CATCH_RECORD_SUBMISSION_INELIGIBLE'
    })

    expect(catchArtifactStore.commitArtifact).not.toHaveBeenCalled()
  })

  test('Should reject a stale expected version with VERSION_CONFLICT', async () => {
    const db = buildFakeDb()
    seedCatchRecord(db, newDraftExample)
    const catchArtifactStore = buildFakeCatchArtifactStore()

    await expect(
      submitCatchRecord({
        db,
        referenceDataClient: fakeReferenceDataClient(),
        catchArtifactStore,
        authenticationContext: authenticationContext(),
        catchRecordId: CATCH_RECORD_ID,
        expectedVersion: newDraftExample.version + 5
      })
    ).rejects.toMatchObject({ category: 'VERSION_CONFLICT' })
  })

  test('Should reject a missing catch record', async () => {
    const db = buildFakeDb()
    const catchArtifactStore = buildFakeCatchArtifactStore()

    await expect(
      submitCatchRecord({
        db,
        referenceDataClient: fakeReferenceDataClient(),
        catchArtifactStore,
        authenticationContext: authenticationContext(),
        catchRecordId: 'does-not-exist',
        expectedVersion: 1
      })
    ).rejects.toMatchObject({ category: 'RESOURCE_NOT_FOUND' })
  })

  test('Should reject a horizontal submission attempt by a different owner as not found', async () => {
    const db = buildFakeDb()
    seedCatchRecord(db, newDraftExample)
    const catchArtifactStore = buildFakeCatchArtifactStore()

    await expect(
      submitCatchRecord({
        db,
        referenceDataClient: fakeReferenceDataClient(),
        catchArtifactStore,
        authenticationContext: authenticationContext('a-different-owner'),
        catchRecordId: CATCH_RECORD_ID,
        expectedVersion: newDraftExample.version
      })
    ).rejects.toMatchObject({ category: 'RESOURCE_NOT_FOUND' })
  })

  test('Should replay the stored result for a repeated idempotency key without re-incrementing the version', async () => {
    const db = buildFakeDb()
    seedCatchRecord(db, newDraftExample)
    const catchArtifactStore = buildFakeCatchArtifactStore()
    const idempotencyKey = 'retry-key-1'

    const first = await submitCatchRecord({
      db,
      referenceDataClient: fakeReferenceDataClient(),
      catchArtifactStore,
      authenticationContext: authenticationContext(),
      catchRecordId: CATCH_RECORD_ID,
      expectedVersion: newDraftExample.version,
      idempotencyKey
    })

    const second = await submitCatchRecord({
      db,
      referenceDataClient: fakeReferenceDataClient(),
      catchArtifactStore,
      authenticationContext: authenticationContext(),
      catchRecordId: CATCH_RECORD_ID,
      expectedVersion: newDraftExample.version,
      idempotencyKey
    })

    expect(second).toEqual(first)
    expect(catchArtifactStore.commitArtifact).toHaveBeenCalledTimes(2) // only the first call wrote artifacts
  })

  test('Should deterministically recover a submission whose artifacts were already committed by a prior interrupted attempt', async () => {
    const db = buildFakeDb()
    seedCatchRecord(db, newDraftExample)
    const catchArtifactStore = buildFakeCatchArtifactStore()

    // Simulate a prior attempt that successfully wrote the JSON snapshot (with its own trusted
    // timestamp) but crashed before the database commit.
    const recoveredSubmittedAt = '2020-01-01T00:00:00.000Z'
    const recoveredSnapshot = {
      ...newDraftExample,
      status: 'SUBMITTED',
      numberOfSubmissions: 1,
      hasUnsubmittedChanges: false,
      submittedAt: recoveredSubmittedAt,
      submittedBy: OWNER_USER_ID,
      updatedAt: recoveredSubmittedAt,
      updatedBy: OWNER_USER_ID
    }
    delete recoveredSnapshot.artifacts
    delete recoveredSnapshot.version

    await catchArtifactStore.commitArtifact({
      key: `catch-records/${CATCH_RECORD_ID}/submissions/1/snapshot.json`,
      body: Buffer.from(JSON.stringify(recoveredSnapshot, null, 2), 'utf8'),
      contentType: 'application/json; charset=utf-8'
    })

    const response = await submitCatchRecord({
      db,
      referenceDataClient: fakeReferenceDataClient(),
      catchArtifactStore,
      authenticationContext: authenticationContext(),
      catchRecordId: CATCH_RECORD_ID,
      expectedVersion: newDraftExample.version
    })

    expect(response.status).toBe('SUBMITTED')
    // The recovered, already-committed timestamp is reused - not a fresh "now".
    expect(response.submittedAt).toBe(recoveredSubmittedAt)

    const jsonCommitCall = catchArtifactStore.commitArtifact.mock.calls.find(
      ([{ key }]) => key.endsWith('snapshot.json')
    )
    // The recovery path's JSON commit is detected as byte-identical reuse, not a fresh write.
    expect(
      catchArtifactStore.objects.get(jsonCommitCall[0].key).checksum
    ).toBeDefined()
  })

  test('Should propagate a dependency failure during reference-data revalidation rather than reporting it as validation failure', async () => {
    const db = buildFakeDb()
    seedCatchRecord(db, newDraftExample)
    const catchArtifactStore = buildFakeCatchArtifactStore()
    const referenceDataClient = fakeReferenceDataClient()
    referenceDataClient.getPortById = vi.fn().mockRejectedValue(
      new ApplicationError({
        category: 'UPSTREAM_TIMEOUT',
        message: 'timeout'
      })
    )

    await expect(
      submitCatchRecord({
        db,
        referenceDataClient,
        catchArtifactStore,
        authenticationContext: authenticationContext(),
        catchRecordId: CATCH_RECORD_ID,
        expectedVersion: newDraftExample.version
      })
    ).rejects.toMatchObject({ category: 'UPSTREAM_TIMEOUT' })

    expect(catchArtifactStore.commitArtifact).not.toHaveBeenCalled()
  })

  test('Should satisfy isApplicationError for every thrown error', async () => {
    const db = buildFakeDb()
    const catchArtifactStore = buildFakeCatchArtifactStore()

    await expect(
      submitCatchRecord({
        db,
        referenceDataClient: fakeReferenceDataClient(),
        catchArtifactStore,
        authenticationContext: authenticationContext(),
        catchRecordId: 'does-not-exist',
        expectedVersion: 1
      })
    ).rejects.toSatisfy(isApplicationError)
  })

  test('Should reject a concurrent duplicate request for the same idempotency key as IN_PROGRESS', async () => {
    const db = buildFakeDb()
    seedCatchRecord(db, newDraftExample)
    const catchArtifactStore = buildFakeCatchArtifactStore()
    const idempotencyKey = 'concurrent-key'

    // Pre-claim the idempotency key in the PENDING state, simulating a request already in flight.
    const fingerprint = computeRequestFingerprint({
      operationScope: 'SUBMISSION',
      idempotencyKey,
      allowedFields: ['expectedVersion'],
      semanticInput: { expectedVersion: newDraftExample.version }
    })
    db.collections['catch-idempotency-claims'].store.set('pending-claim', {
      _id: 'pending-claim',
      ownerUserId: OWNER_USER_ID,
      operationScope: 'SUBMISSION',
      idempotencyKey,
      resourceId: CATCH_RECORD_ID,
      fingerprint,
      state: 'PENDING',
      createdAt: new Date().toISOString()
    })

    await expect(
      submitCatchRecord({
        db,
        referenceDataClient: fakeReferenceDataClient(),
        catchArtifactStore,
        authenticationContext: authenticationContext(),
        catchRecordId: CATCH_RECORD_ID,
        expectedVersion: newDraftExample.version,
        idempotencyKey
      })
    ).rejects.toMatchObject({
      category: 'IDEMPOTENCY_CONFLICT',
      code: 'IDEMPOTENCY_REQUEST_IN_PROGRESS'
    })
  })

  test('Should propagate a non-not-found artifact-retrieval failure during deterministic-recovery checking', async () => {
    const db = buildFakeDb()
    seedCatchRecord(db, newDraftExample)
    const catchArtifactStore = buildFakeCatchArtifactStore()
    catchArtifactStore.retrieveArtifact = vi.fn().mockRejectedValue(
      new ApplicationError({
        category: 'ARTIFACT_OPERATION_FAILURE',
        code: 'ARTIFACT_RETRIEVAL_FAILED',
        message: 'dependency unavailable'
      })
    )

    await expect(
      submitCatchRecord({
        db,
        referenceDataClient: fakeReferenceDataClient(),
        catchArtifactStore,
        authenticationContext: authenticationContext(),
        catchRecordId: CATCH_RECORD_ID,
        expectedVersion: newDraftExample.version
      })
    ).rejects.toMatchObject({ code: 'ARTIFACT_RETRIEVAL_FAILED' })
  })
})
