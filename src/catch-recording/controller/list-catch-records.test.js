import { listCatchRecords } from './list-catch-records.js'
import {
  newDraftExample,
  amendedDraftExample,
  submittedExample,
  completeExample
} from '#/catch-recording/domain/__fixtures__/canonical-catch-record.fixtures.js'

const OWNER_USER_ID = newDraftExample.ownerUserId

function buildFakeCollection(documents) {
  const toArray = vi.fn().mockResolvedValue(documents)
  const limit = vi.fn().mockReturnValue({ toArray })
  const sort = vi.fn().mockReturnValue({ limit })
  return {
    find: vi.fn().mockReturnValue({ sort }),
    createIndex: vi.fn()
  }
}

function buildFakeDb(documents) {
  const collection = buildFakeCollection(documents)
  return { collection: vi.fn(() => collection), _collection: collection }
}

function toDocument(canonicalRecord) {
  return { ...canonicalRecord, _id: canonicalRecord.id }
}

describe('listCatchRecords', () => {
  test('returns the approved envelope with minimal summaries, using the trusted owner', async () => {
    const db = buildFakeDb([toDocument(newDraftExample)])

    const result = await listCatchRecords({
      db,
      authenticationContext: { userId: OWNER_USER_ID, scopes: [] },
      limit: 20
    })

    expect(result.limit).toBe(20)
    expect(result.count).toBe(1)
    expect(result.items).toHaveLength(1)

    const [summary] = result.items
    expect(summary).toEqual({
      id: newDraftExample.id,
      catchRecordReference: newDraftExample.catchRecordReference,
      status: 'DRAFT',
      displayStatus: 'Draft',
      version: newDraftExample.version,
      vessel: {
        nameSnapshot: newDraftExample.vessel.nameSnapshot,
        rssSnapshot: newDraftExample.vessel.rssSnapshot
      },
      trip: {
        dateStarted: newDraftExample.trip.dateStarted ?? null,
        dateEnded: newDraftExample.trip.dateEnded ?? null
      },
      createdAt: newDraftExample.createdAt,
      updatedAt: newDraftExample.updatedAt,
      submittedAt: newDraftExample.submittedAt,
      completedAt: newDraftExample.completedAt,
      progress: { allGearsComplete: true }
    })
  })

  test('derives Amended for a DRAFT with prior submissions', async () => {
    const db = buildFakeDb([toDocument(amendedDraftExample)])

    const result = await listCatchRecords({
      db,
      authenticationContext: { userId: OWNER_USER_ID, scopes: [] },
      limit: 20
    })

    expect(result.items[0].displayStatus).toBe('Amended')
  })

  test('derives Submitted and Complete for their respective persisted statuses', async () => {
    const db = buildFakeDb([
      toDocument(submittedExample),
      toDocument(completeExample)
    ])

    const result = await listCatchRecords({
      db,
      authenticationContext: { userId: OWNER_USER_ID, scopes: [] },
      limit: 20
    })

    expect(result.items.map((item) => item.displayStatus)).toEqual([
      'Submitted',
      'Complete'
    ])
  })

  test('derives allGearsComplete true when every gear is complete', async () => {
    const db = buildFakeDb([toDocument(submittedExample)])

    const result = await listCatchRecords({
      db,
      authenticationContext: { userId: OWNER_USER_ID, scopes: [] },
      limit: 20
    })

    expect(result.items[0].progress.allGearsComplete).toBe(true)
  })

  test('derives allGearsComplete false when gears are empty or incomplete', async () => {
    const incompleteDraft = { ...newDraftExample, gears: [] }
    const db = buildFakeDb([toDocument(incompleteDraft)])

    const result = await listCatchRecords({
      db,
      authenticationContext: { userId: OWNER_USER_ID, scopes: [] },
      limit: 20
    })

    expect(result.items[0].progress.allGearsComplete).toBe(false)
  })

  test('passes the trusted owner, limit, and status through to persistence', async () => {
    const db = buildFakeDb([])

    await listCatchRecords({
      db,
      authenticationContext: { userId: OWNER_USER_ID, scopes: [] },
      limit: 5,
      status: 'DRAFT'
    })

    expect(db._collection.find).toHaveBeenCalledWith({
      ownerUserId: OWNER_USER_ID,
      status: 'DRAFT'
    })
  })

  test('falls back to null trip dates when trip is absent', async () => {
    const recordWithoutTrip = { ...newDraftExample, trip: {} }
    const db = buildFakeDb([toDocument(recordWithoutTrip)])

    const result = await listCatchRecords({
      db,
      authenticationContext: { userId: OWNER_USER_ID, scopes: [] },
      limit: 20
    })

    expect(result.items[0].trip).toEqual({ dateStarted: null, dateEnded: null })
  })

  test('returns a successful empty envelope when the owner has no records', async () => {
    const db = buildFakeDb([])

    const result = await listCatchRecords({
      db,
      authenticationContext: { userId: OWNER_USER_ID, scopes: [] },
      limit: 20
    })

    expect(result).toEqual({ items: [], limit: 20, count: 0 })
  })

  test('never includes complete gear/species collections or frontend navigation fields', async () => {
    const db = buildFakeDb([toDocument(submittedExample)])

    const result = await listCatchRecords({
      db,
      authenticationContext: { userId: OWNER_USER_ID, scopes: [] },
      limit: 20
    })

    const [summary] = result.items
    expect(summary).not.toHaveProperty('gears')
    expect(summary).not.toHaveProperty('speciesNotLanded')
    expect(summary).not.toHaveProperty('currentStep')
    expect(summary).not.toHaveProperty('nextStep')
    expect(summary).not.toHaveProperty('route')
  })

  test('the response envelope and every summary are frozen (immutability)', async () => {
    const db = buildFakeDb([toDocument(newDraftExample)])

    const result = await listCatchRecords({
      db,
      authenticationContext: { userId: OWNER_USER_ID, scopes: [] },
      limit: 20
    })

    expect(Object.isFrozen(result)).toBe(true)
    expect(Object.isFrozen(result.items)).toBe(true)
    expect(Object.isFrozen(result.items[0])).toBe(true)
  })
})
