import {
  appendCatchHistoryEvent,
  listCatchHistoryEventsForOwner,
  CATCH_HISTORY_COLLECTION
} from './catch-history-persistence.js'
import { CATCH_HISTORY_EVENT_TYPES } from './catch-history-event.js'

function buildInput(overrides = {}) {
  return {
    catchRecordId: 'catch-record-1',
    ownerUserId: 'owner-1',
    eventType: CATCH_HISTORY_EVENT_TYPES.DRAFT_CREATED,
    timestamp: '2026-01-01T00:00:00Z',
    actorUserId: 'actor-1',
    ...overrides
  }
}

describe('#catch-history-persistence (MongoDB integration)', () => {
  let server
  let db

  beforeAll(async () => {
    // Dynamic import needed due to config being updated by vitest-mongodb (mirrors
    // `catch-persistence.integration.test.js`'s existing established pattern).
    const { createServer } = await import('#/server.js')

    server = await createServer()
    await server.initialize()
    db = server.db
  })

  afterAll(async () => {
    await server.stop({ timeout: 1000 })
  })

  afterEach(async () => {
    await db.collection(CATCH_HISTORY_COLLECTION).deleteMany({})
  })

  describe('indexes', () => {
    test('Should create the one approved compound index idempotently', async () => {
      const indexes = await db.collection(CATCH_HISTORY_COLLECTION).indexes()

      const compoundIndex = indexes.find(
        (index) =>
          Object.keys(index.key).join() ===
          'catchRecordId,ownerUserId,timestamp,_id'
      )

      expect(compoundIndex).toBeDefined()
      expect(compoundIndex.key).toEqual({
        catchRecordId: 1,
        ownerUserId: 1,
        timestamp: 1,
        _id: 1
      })

      // Re-running index creation must not error or create a duplicate index.
      const { ensureCatchHistoryIndexes } =
        await import('./catch-history-collection.js')
      await expect(ensureCatchHistoryIndexes(db)).resolves.toBeUndefined()

      const indexesAfterRerun = await db
        .collection(CATCH_HISTORY_COLLECTION)
        .indexes()
      expect(indexesAfterRerun).toHaveLength(indexes.length)
    })
  })

  describe('append and retrieve', () => {
    test('Should append one event and retrieve it for its owner', async () => {
      const input = buildInput()

      const appended = await appendCatchHistoryEvent(db, input)
      expect(appended).toMatchObject(input)
      expect(appended.id).toEqual(expect.any(String))

      const documentCount = await db
        .collection(CATCH_HISTORY_COLLECTION)
        .countDocuments({ catchRecordId: input.catchRecordId })
      expect(documentCount).toBe(1)

      const results = await listCatchHistoryEventsForOwner(db, {
        catchRecordId: input.catchRecordId,
        ownerUserId: input.ownerUserId,
        limit: 10
      })

      expect(results).toHaveLength(1)
      expect(results[0]).toEqual(appended)
    })

    test('Should append multiple events for the same Catch Record', async () => {
      const catchRecordId = 'catch-record-multi'
      const ownerUserId = 'owner-multi'

      await appendCatchHistoryEvent(
        db,
        buildInput({
          catchRecordId,
          ownerUserId,
          eventType: CATCH_HISTORY_EVENT_TYPES.DRAFT_CREATED,
          timestamp: '2026-01-01T00:00:00Z'
        })
      )
      await appendCatchHistoryEvent(
        db,
        buildInput({
          catchRecordId,
          ownerUserId,
          eventType: CATCH_HISTORY_EVENT_TYPES.SECTION_SAVED,
          timestamp: '2026-01-02T00:00:00Z',
          metadata: { section: 'vessel' }
        })
      )
      await appendCatchHistoryEvent(
        db,
        buildInput({
          catchRecordId,
          ownerUserId,
          eventType: CATCH_HISTORY_EVENT_TYPES.SUBMITTED,
          timestamp: '2026-01-03T00:00:00Z',
          metadata: { submissionNumber: 1 }
        })
      )

      const results = await listCatchHistoryEventsForOwner(db, {
        catchRecordId,
        ownerUserId,
        limit: 10
      })

      expect(results).toHaveLength(3)
      expect(results.map((event) => event.eventType)).toEqual([
        CATCH_HISTORY_EVENT_TYPES.DRAFT_CREATED,
        CATCH_HISTORY_EVENT_TYPES.SECTION_SAVED,
        CATCH_HISTORY_EVENT_TYPES.SUBMITTED
      ])
    })

    test('Should never update, replace, or delete an existing appended event', async () => {
      const input = buildInput({ catchRecordId: 'catch-record-append-only' })
      await appendCatchHistoryEvent(db, input)
      await appendCatchHistoryEvent(db, input)

      const documentCount = await db
        .collection(CATCH_HISTORY_COLLECTION)
        .countDocuments({ catchRecordId: input.catchRecordId })

      // Two independent appends of an otherwise identical event both persist - no silent
      // deduplication, no upsert, no replacement (Step 12 owns idempotency, not Step 10).
      expect(documentCount).toBe(2)
    })
  })

  describe('owner-safe query', () => {
    test('Should return no events for a different owner of the same Catch Record', async () => {
      const catchRecordId = 'catch-record-cross-owner'
      await appendCatchHistoryEvent(
        db,
        buildInput({ catchRecordId, ownerUserId: 'owner-a' })
      )

      const results = await listCatchHistoryEventsForOwner(db, {
        catchRecordId,
        ownerUserId: 'owner-b',
        limit: 10
      })

      expect(results).toEqual([])
    })

    test('Should not reveal whether another owner has history for an unknown Catch Record', async () => {
      const results = await listCatchHistoryEventsForOwner(db, {
        catchRecordId: 'catch-record-does-not-exist',
        ownerUserId: 'owner-unknown',
        limit: 10
      })

      expect(results).toEqual([])
    })

    test('Should return an empty collection, not an error, for a Catch Record with no history', async () => {
      await expect(
        listCatchHistoryEventsForOwner(db, {
          catchRecordId: 'catch-record-no-history',
          ownerUserId: 'owner-1',
          limit: 10
        })
      ).resolves.toEqual([])
    })
  })

  describe('deterministic ordering', () => {
    test('Should order ascending by timestamp', async () => {
      const catchRecordId = 'catch-record-order'
      const ownerUserId = 'owner-order'

      await appendCatchHistoryEvent(
        db,
        buildInput({
          catchRecordId,
          ownerUserId,
          eventType: CATCH_HISTORY_EVENT_TYPES.SUBMITTED,
          timestamp: '2026-03-01T00:00:00Z'
        })
      )
      await appendCatchHistoryEvent(
        db,
        buildInput({
          catchRecordId,
          ownerUserId,
          eventType: CATCH_HISTORY_EVENT_TYPES.DRAFT_CREATED,
          timestamp: '2026-01-01T00:00:00Z'
        })
      )
      await appendCatchHistoryEvent(
        db,
        buildInput({
          catchRecordId,
          ownerUserId,
          eventType: CATCH_HISTORY_EVENT_TYPES.SECTION_SAVED,
          timestamp: '2026-02-01T00:00:00Z'
        })
      )

      const results = await listCatchHistoryEventsForOwner(db, {
        catchRecordId,
        ownerUserId,
        limit: 10
      })

      expect(results.map((event) => event.eventType)).toEqual([
        CATCH_HISTORY_EVENT_TYPES.DRAFT_CREATED,
        CATCH_HISTORY_EVENT_TYPES.SECTION_SAVED,
        CATCH_HISTORY_EVENT_TYPES.SUBMITTED
      ])
    })

    test('Should use a stable _id tie-breaker for equal timestamps, consistently across repeated queries', async () => {
      const catchRecordId = 'catch-record-tie-breaker'
      const ownerUserId = 'owner-tie-breaker'
      const sharedTimestamp = '2026-04-01T00:00:00Z'

      const first = await appendCatchHistoryEvent(
        db,
        buildInput({
          catchRecordId,
          ownerUserId,
          eventType: CATCH_HISTORY_EVENT_TYPES.DRAFT_CREATED,
          timestamp: sharedTimestamp
        })
      )
      const second = await appendCatchHistoryEvent(
        db,
        buildInput({
          catchRecordId,
          ownerUserId,
          eventType: CATCH_HISTORY_EVENT_TYPES.SECTION_SAVED,
          timestamp: sharedTimestamp
        })
      )

      const firstQuery = await listCatchHistoryEventsForOwner(db, {
        catchRecordId,
        ownerUserId,
        limit: 10
      })
      const secondQuery = await listCatchHistoryEventsForOwner(db, {
        catchRecordId,
        ownerUserId,
        limit: 10
      })

      expect(firstQuery.map((event) => event.id)).toEqual([first.id, second.id])
      expect(secondQuery.map((event) => event.id)).toEqual(
        firstQuery.map((event) => event.id)
      )
    })
  })

  describe('bounded query', () => {
    test('Should bound the result set by the supplied limit', async () => {
      const catchRecordId = 'catch-record-bounded'
      const ownerUserId = 'owner-bounded'

      await appendCatchHistoryEvent(
        db,
        buildInput({
          catchRecordId,
          ownerUserId,
          timestamp: '2026-01-01T00:00:00Z'
        })
      )
      await appendCatchHistoryEvent(
        db,
        buildInput({
          catchRecordId,
          ownerUserId,
          timestamp: '2026-01-02T00:00:00Z'
        })
      )
      await appendCatchHistoryEvent(
        db,
        buildInput({
          catchRecordId,
          ownerUserId,
          timestamp: '2026-01-03T00:00:00Z'
        })
      )

      const results = await listCatchHistoryEventsForOwner(db, {
        catchRecordId,
        ownerUserId,
        limit: 2
      })

      expect(results).toHaveLength(2)
    })
  })

  describe('mapping round trip', () => {
    test('Should preserve metadata through append and retrieval', async () => {
      const input = buildInput({
        catchRecordId: 'catch-record-metadata',
        eventType: CATCH_HISTORY_EVENT_TYPES.AMENDMENT_SECTION_SAVED,
        metadata: { section: 'landing', submissionNumber: 2 }
      })

      await appendCatchHistoryEvent(db, input)

      const results = await listCatchHistoryEventsForOwner(db, {
        catchRecordId: input.catchRecordId,
        ownerUserId: input.ownerUserId,
        limit: 10
      })

      expect(results[0].metadata).toEqual({
        section: 'landing',
        submissionNumber: 2
      })
    })
  })
})
