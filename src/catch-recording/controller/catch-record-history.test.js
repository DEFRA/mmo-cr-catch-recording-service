import { getCatchRecordHistory } from './catch-record-history.js'

const OWNER_USER_ID = 'owner-1'
const RECORD_ID = 'record-1'

function catchRecordDocument(overrides = {}) {
  return {
    _id: RECORD_ID,
    schemaVersion: 1,
    catchRecordReference: 'GBR-RSS123456-051026-113500',
    ownerUserId: OWNER_USER_ID,
    status: 'DRAFT',
    numberOfSubmissions: 0,
    hasUnsubmittedChanges: false,
    submittedAt: null,
    submittedBy: null,
    completedAt: null,
    completedBy: null,
    artifacts: [],
    version: 1,
    vessel: {},
    trip: {},
    pairFishing: { enabled: false, pairVessel: null, pairSkipperName: null },
    gears: [],
    speciesNotLanded: [],
    createdAt: '2026-10-05T10:35:00Z',
    createdBy: OWNER_USER_ID,
    updatedAt: '2026-10-05T10:35:00Z',
    updatedBy: OWNER_USER_ID,
    ...overrides
  }
}

function historyDocument(overrides = {}) {
  return {
    _id: 'event-1',
    catchRecordId: RECORD_ID,
    ownerUserId: OWNER_USER_ID,
    eventType: 'DRAFT_CREATED',
    timestamp: '2026-10-05T10:35:00Z',
    actorUserId: OWNER_USER_ID,
    ...overrides
  }
}

function buildFakeDb({ record, historyDocuments = [] }) {
  const recordCollection = {
    findOne: vi.fn(async (filter) => {
      if (!record) {
        return null
      }
      const matches = Object.entries(filter).every(
        ([key, value]) => record[key] === value
      )
      return matches ? record : null
    })
  }

  const historyCollection = {
    find: vi.fn((filter) => {
      const matches = historyDocuments.filter((document) =>
        Object.entries(filter).every(([key, value]) => document[key] === value)
      )
      return {
        sort: () => ({
          limit: (limit) => ({
            toArray: async () => matches.slice(0, limit)
          })
        })
      }
    })
  }

  const collections = {
    'catch-records': recordCollection,
    'catch-record-history': historyCollection
  }

  return { collection: (name) => collections[name], _collections: collections }
}

function authenticationContext(userId = OWNER_USER_ID) {
  return Object.freeze({ userId, scopes: Object.freeze([]) })
}

describe('#getCatchRecordHistory', () => {
  test('returns the current lifecycle state plus the combined event history', async () => {
    const db = buildFakeDb({
      record: catchRecordDocument(),
      historyDocuments: [
        historyDocument({
          _id: 'event-1',
          eventType: 'DRAFT_CREATED',
          timestamp: '2026-10-05T10:35:00Z'
        }),
        historyDocument({
          _id: 'event-2',
          eventType: 'SECTION_SAVED',
          timestamp: '2026-10-05T11:00:00Z',
          metadata: { section: 'trip' }
        })
      ]
    })

    const result = await getCatchRecordHistory({
      db,
      authenticationContext: authenticationContext(),
      catchRecordId: RECORD_ID,
      limit: 20
    })

    expect(result.catchRecordId).toBe(RECORD_ID)
    expect(result.status).toBe('DRAFT')
    expect(result.displayStatus).toBe('Draft')
    expect(result.version).toBe(1)
    expect(result.hasUnsubmittedChanges).toBe(false)
    expect(result.numberOfSubmissions).toBe(0)
    expect(result.events).toHaveLength(2)
    expect(result.events[0]).toEqual({
      id: 'event-1',
      eventType: 'DRAFT_CREATED',
      timestamp: '2026-10-05T10:35:00Z',
      actor: OWNER_USER_ID
    })
    expect(result.events[1]).toEqual({
      id: 'event-2',
      eventType: 'SECTION_SAVED',
      timestamp: '2026-10-05T11:00:00Z',
      actor: OWNER_USER_ID,
      section: 'trip'
    })
  })

  test('includes submissionNumber only when the event carries it', async () => {
    const db = buildFakeDb({
      record: catchRecordDocument({
        status: 'SUBMITTED',
        numberOfSubmissions: 1
      }),
      historyDocuments: [
        historyDocument({
          eventType: 'SUBMITTED',
          metadata: { submissionNumber: 1 }
        })
      ]
    })

    const result = await getCatchRecordHistory({
      db,
      authenticationContext: authenticationContext(),
      catchRecordId: RECORD_ID,
      limit: 20
    })

    expect(result.events[0].submissionNumber).toBe(1)
    expect(result.events[0]).not.toHaveProperty('section')
  })

  test('derives Amended display status for an amended draft', async () => {
    const db = buildFakeDb({
      record: catchRecordDocument({ numberOfSubmissions: 1 }),
      historyDocuments: []
    })

    const result = await getCatchRecordHistory({
      db,
      authenticationContext: authenticationContext(),
      catchRecordId: RECORD_ID,
      limit: 20
    })

    expect(result.displayStatus).toBe('Amended')
  })

  test('returns a successful empty events array for a new draft with no history', async () => {
    const db = buildFakeDb({
      record: catchRecordDocument(),
      historyDocuments: []
    })

    const result = await getCatchRecordHistory({
      db,
      authenticationContext: authenticationContext(),
      catchRecordId: RECORD_ID,
      limit: 20
    })

    expect(result.events).toEqual([])
  })

  test('preserves deterministic ordering as returned by persistence (oldest first)', async () => {
    const db = buildFakeDb({
      record: catchRecordDocument(),
      historyDocuments: [
        historyDocument({ _id: 'event-1', timestamp: '2026-10-05T10:00:00Z' }),
        historyDocument({ _id: 'event-2', timestamp: '2026-10-05T11:00:00Z' }),
        historyDocument({ _id: 'event-3', timestamp: '2026-10-05T12:00:00Z' })
      ]
    })

    const result = await getCatchRecordHistory({
      db,
      authenticationContext: authenticationContext(),
      catchRecordId: RECORD_ID,
      limit: 20
    })

    expect(result.events.map((event) => event.id)).toEqual([
      'event-1',
      'event-2',
      'event-3'
    ])
  })

  test('bounds the number of returned events by the supplied limit', async () => {
    const db = buildFakeDb({
      record: catchRecordDocument(),
      historyDocuments: [
        historyDocument({ _id: 'event-1' }),
        historyDocument({ _id: 'event-2' }),
        historyDocument({ _id: 'event-3' })
      ]
    })

    const result = await getCatchRecordHistory({
      db,
      authenticationContext: authenticationContext(),
      catchRecordId: RECORD_ID,
      limit: 2
    })

    expect(result.events).toHaveLength(2)
  })

  test('throws CATCH_RECORD_NOT_FOUND for a missing record', async () => {
    const db = buildFakeDb({ record: null })

    await expect(
      getCatchRecordHistory({
        db,
        authenticationContext: authenticationContext(),
        catchRecordId: 'does-not-exist',
        limit: 20
      })
    ).rejects.toMatchObject({
      category: 'RESOURCE_NOT_FOUND',
      code: 'CATCH_RECORD_NOT_FOUND'
    })
  })

  test("throws the identical CATCH_RECORD_NOT_FOUND for another owner's record (no disclosure)", async () => {
    const db = buildFakeDb({ record: catchRecordDocument() })

    await expect(
      getCatchRecordHistory({
        db,
        authenticationContext: authenticationContext('someone-else'),
        catchRecordId: RECORD_ID,
        limit: 20
      })
    ).rejects.toMatchObject({ category: 'RESOURCE_NOT_FOUND' })
  })

  test('never returns complete record content or internal fields', async () => {
    const db = buildFakeDb({
      record: catchRecordDocument(),
      historyDocuments: [historyDocument()]
    })

    const result = await getCatchRecordHistory({
      db,
      authenticationContext: authenticationContext(),
      catchRecordId: RECORD_ID,
      limit: 20
    })

    expect(result).not.toHaveProperty('gears')
    expect(result).not.toHaveProperty('vessel')
    expect(result.events[0]).not.toHaveProperty('catchRecordId')
    expect(result.events[0]).not.toHaveProperty('ownerUserId')
    expect(result.events[0]).not.toHaveProperty('metadata')
  })

  test('the response is frozen (immutability)', async () => {
    const db = buildFakeDb({
      record: catchRecordDocument(),
      historyDocuments: [historyDocument()]
    })

    const result = await getCatchRecordHistory({
      db,
      authenticationContext: authenticationContext(),
      catchRecordId: RECORD_ID,
      limit: 20
    })

    expect(Object.isFrozen(result)).toBe(true)
    expect(Object.isFrozen(result.events)).toBe(true)
    expect(Object.isFrozen(result.events[0])).toBe(true)
  })
})
