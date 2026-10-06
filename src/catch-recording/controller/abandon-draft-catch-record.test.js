import { randomUUID } from 'node:crypto'

import { abandonDraftCatchRecord } from './abandon-draft-catch-record.js'

const OWNER_USER_ID = 'owner-1'
const RECORD_ID = 'record-1'

function buildFakeCollection() {
  const store = new Map()
  return {
    findOneAndDelete: vi.fn(async (filter) => {
      for (const [id, document] of store.entries()) {
        const matches = Object.entries(filter).every(
          ([key, value]) => document[key] === value
        )
        if (matches) {
          store.delete(id)
          return document
        }
      }
      return null
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
    insertOne: vi.fn(async (document) => {
      const id = document._id ?? randomUUID()
      store.set(id, { ...document, _id: id })
      return { acknowledged: true, insertedId: id }
    }),
    seed(document) {
      store.set(document._id, document)
    }
  }
}

function buildFakeDb() {
  const catchRecords = buildFakeCollection()
  const history = buildFakeCollection()
  const collections = {
    'catch-records': catchRecords,
    'catch-record-history': history
  }
  return { collection: (name) => collections[name], collections }
}

function eligibleDraft(overrides = {}) {
  return {
    _id: RECORD_ID,
    schemaVersion: 1,
    catchRecordReference: 'GBR-RSS123456-051026-113500',
    ownerUserId: OWNER_USER_ID,
    status: 'DRAFT',
    numberOfSubmissions: 0,
    submittedAt: null,
    submittedBy: null,
    version: 1,
    gears: [],
    ...overrides
  }
}

function authenticationContext(userId = OWNER_USER_ID) {
  return Object.freeze({ userId, scopes: Object.freeze([]) })
}

describe('#abandonDraftCatchRecord', () => {
  test('deletes an eligible never-submitted draft and appends DRAFT_ABANDONED history', async () => {
    const db = buildFakeDb()
    db.collections['catch-records'].seed(eligibleDraft())

    await abandonDraftCatchRecord({
      db,
      authenticationContext: authenticationContext(),
      catchRecordId: RECORD_ID,
      expectedVersion: 1
    })

    expect(db.collections['catch-records'].findOneAndDelete).toHaveBeenCalled()
    const historyInsert =
      db.collections['catch-record-history'].insertOne.mock.calls[0][0]
    expect(historyInsert.eventType).toBe('DRAFT_ABANDONED')
    expect(historyInsert.ownerUserId).toBe(OWNER_USER_ID)
  })

  test('is a safe no-op (no error, no history) for a record that does not exist', async () => {
    const db = buildFakeDb()

    await expect(
      abandonDraftCatchRecord({
        db,
        authenticationContext: authenticationContext(),
        catchRecordId: 'does-not-exist',
        expectedVersion: 1
      })
    ).resolves.toBeUndefined()

    expect(
      db.collections['catch-record-history'].insertOne
    ).not.toHaveBeenCalled()
  })

  test('is a safe no-op for a non-owner attempt (indistinguishable from missing)', async () => {
    const db = buildFakeDb()
    db.collections['catch-records'].seed(eligibleDraft())

    await expect(
      abandonDraftCatchRecord({
        db,
        authenticationContext: authenticationContext('a-different-owner'),
        catchRecordId: RECORD_ID,
        expectedVersion: 1
      })
    ).resolves.toBeUndefined()
  })

  test('is idempotent: a repeated abandonment of the same draft is a safe no-op, not an error', async () => {
    const db = buildFakeDb()
    db.collections['catch-records'].seed(eligibleDraft())

    await abandonDraftCatchRecord({
      db,
      authenticationContext: authenticationContext(),
      catchRecordId: RECORD_ID,
      expectedVersion: 1
    })

    await expect(
      abandonDraftCatchRecord({
        db,
        authenticationContext: authenticationContext(),
        catchRecordId: RECORD_ID,
        expectedVersion: 1
      })
    ).resolves.toBeUndefined()
  })

  test('rejects an already-submitted record with INVALID_LIFECYCLE_TRANSITION', async () => {
    const db = buildFakeDb()
    db.collections['catch-records'].seed(
      eligibleDraft({
        status: 'SUBMITTED',
        numberOfSubmissions: 1,
        submittedAt: '2026-10-05T12:15:00Z',
        submittedBy: OWNER_USER_ID
      })
    )

    await expect(
      abandonDraftCatchRecord({
        db,
        authenticationContext: authenticationContext(),
        catchRecordId: RECORD_ID,
        expectedVersion: 1
      })
    ).rejects.toMatchObject({ category: 'INVALID_LIFECYCLE_TRANSITION' })
  })

  test('rejects a COMPLETE record with INVALID_LIFECYCLE_TRANSITION', async () => {
    const db = buildFakeDb()
    db.collections['catch-records'].seed(
      eligibleDraft({
        status: 'COMPLETE',
        numberOfSubmissions: 1,
        submittedAt: '2026-10-05T12:15:00Z',
        submittedBy: OWNER_USER_ID
      })
    )

    await expect(
      abandonDraftCatchRecord({
        db,
        authenticationContext: authenticationContext(),
        catchRecordId: RECORD_ID,
        expectedVersion: 1
      })
    ).rejects.toMatchObject({ category: 'INVALID_LIFECYCLE_TRANSITION' })
  })

  test('rejects an amended draft (DRAFT with a prior submission) with INVALID_LIFECYCLE_TRANSITION', async () => {
    const db = buildFakeDb()
    db.collections['catch-records'].seed(
      eligibleDraft({
        status: 'DRAFT',
        numberOfSubmissions: 1,
        submittedAt: '2026-10-05T12:15:00Z',
        submittedBy: OWNER_USER_ID
      })
    )

    await expect(
      abandonDraftCatchRecord({
        db,
        authenticationContext: authenticationContext(),
        catchRecordId: RECORD_ID,
        expectedVersion: 1
      })
    ).rejects.toMatchObject({ category: 'INVALID_LIFECYCLE_TRANSITION' })
  })

  test('rejects a stale expected version on an otherwise-eligible draft with VERSION_CONFLICT', async () => {
    const db = buildFakeDb()
    db.collections['catch-records'].seed(eligibleDraft({ version: 2 }))

    await expect(
      abandonDraftCatchRecord({
        db,
        authenticationContext: authenticationContext(),
        catchRecordId: RECORD_ID,
        expectedVersion: 1
      })
    ).rejects.toMatchObject({ category: 'VERSION_CONFLICT' })
  })

  test('rejects an invalid expectedVersion before touching the database', async () => {
    const db = buildFakeDb()

    await expect(
      abandonDraftCatchRecord({
        db,
        authenticationContext: authenticationContext(),
        catchRecordId: RECORD_ID,
        expectedVersion: 0
      })
    ).rejects.toThrow(TypeError)

    expect(
      db.collections['catch-records'].findOneAndDelete
    ).not.toHaveBeenCalled()
  })
})
