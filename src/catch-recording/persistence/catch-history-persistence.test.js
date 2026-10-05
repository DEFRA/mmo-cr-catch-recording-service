import {
  appendCatchHistoryEvent,
  listCatchHistoryEventsForOwner,
  MAX_HISTORY_LIST_LIMIT
} from './catch-history-persistence.js'
import { CATCH_HISTORY_EVENT_TYPES } from './catch-history-event.js'

function validInput(overrides = {}) {
  return {
    catchRecordId: 'catch-record-1',
    ownerUserId: 'owner-1',
    eventType: CATCH_HISTORY_EVENT_TYPES.DRAFT_CREATED,
    timestamp: '2026-01-01T00:00:00Z',
    actorUserId: 'actor-1',
    ...overrides
  }
}

function buildFakeCollection(overrides = {}) {
  return {
    insertOne: vi.fn().mockResolvedValue({ insertedId: 'generated-id' }),
    find: vi.fn(),
    ...overrides
  }
}

function buildFakeDb(collection) {
  return { collection: vi.fn().mockReturnValue(collection) }
}

function findChain(documents) {
  const toArray = vi.fn().mockResolvedValue(documents)
  const limit = vi.fn().mockReturnValue({ toArray })
  const sort = vi.fn().mockReturnValue({ limit })
  return { find: vi.fn().mockReturnValue({ sort }), sort, limit, toArray }
}

describe('#catch-history-persistence', () => {
  describe('appendCatchHistoryEvent', () => {
    test('Should insert exactly one mapped document and return the mapped event', async () => {
      const collection = buildFakeCollection()
      const db = buildFakeDb(collection)
      const input = validInput()

      const result = await appendCatchHistoryEvent(db, input)

      expect(db.collection).toHaveBeenCalledExactlyOnceWith(
        'catch-record-history'
      )
      expect(collection.insertOne).toHaveBeenCalledExactlyOnceWith({
        catchRecordId: input.catchRecordId,
        ownerUserId: input.ownerUserId,
        eventType: input.eventType,
        timestamp: input.timestamp,
        actorUserId: input.actorUserId
      })
      expect(result).toEqual({ id: 'generated-id', ...input })
    })

    test('Should not call any update, replace, or delete method', async () => {
      const collection = buildFakeCollection()
      const db = buildFakeDb(collection)

      await appendCatchHistoryEvent(db, validInput())

      expect(collection.updateOne).toBeUndefined()
      expect(collection.findOneAndUpdate).toBeUndefined()
      expect(collection.deleteOne).toBeUndefined()
      expect(collection.replaceOne).toBeUndefined()
    })

    test('Should not mutate the caller-supplied input', async () => {
      const collection = buildFakeCollection()
      const db = buildFakeDb(collection)
      const input = validInput({ metadata: { section: 'vessel' } })
      const snapshot = structuredClone(input)

      await appendCatchHistoryEvent(db, input)

      expect(input).toEqual(snapshot)
    })

    test('Should reject invalid input before any driver call', async () => {
      const collection = buildFakeCollection()
      const db = buildFakeDb(collection)

      await expect(
        appendCatchHistoryEvent(db, validInput({ eventType: 'WITHDRAWN' }))
      ).rejects.toThrow(TypeError)

      expect(collection.insertOne).not.toHaveBeenCalled()
    })

    test('Should translate an unexpected insert failure safely', async () => {
      const collection = buildFakeCollection({
        insertOne: vi.fn().mockRejectedValue(new Error('connection reset'))
      })
      const db = buildFakeDb(collection)

      await expect(
        appendCatchHistoryEvent(db, validInput())
      ).rejects.toMatchObject({
        category: 'UNEXPECTED_INTERNAL_FAILURE',
        code: 'CATCH_RECORD_HISTORY_PERSISTENCE_FAILURE'
      })
    })

    test('Should never expose the raw driver error', async () => {
      const collection = buildFakeCollection({
        insertOne: vi
          .fn()
          .mockRejectedValue(
            new Error('mongodb://user:pass@host/db connection failure')
          )
      })
      const db = buildFakeDb(collection)

      let caught
      try {
        await appendCatchHistoryEvent(db, validInput())
      } catch (error) {
        caught = error
      }

      expect(caught).toBeDefined()
      expect(caught.message).not.toContain('mongodb://')
    })
  })

  describe('listCatchHistoryEventsForOwner', () => {
    test('Should query owner-scoped only, sorted deterministically, bounded by limit', async () => {
      const chain = findChain([])
      const collection = buildFakeCollection({ find: chain.find })
      const db = buildFakeDb(collection)

      await listCatchHistoryEventsForOwner(db, {
        catchRecordId: 'catch-record-1',
        ownerUserId: 'owner-1',
        limit: 10
      })

      expect(chain.find).toHaveBeenCalledExactlyOnceWith({
        catchRecordId: 'catch-record-1',
        ownerUserId: 'owner-1'
      })
      expect(chain.sort).toHaveBeenCalledExactlyOnceWith({
        timestamp: 1,
        _id: 1
      })
      expect(chain.limit).toHaveBeenCalledExactlyOnceWith(10)
    })

    test('Should map every returned document to a framework-neutral event', async () => {
      const documents = [
        {
          _id: 'id-1',
          catchRecordId: 'catch-record-1',
          ownerUserId: 'owner-1',
          eventType: CATCH_HISTORY_EVENT_TYPES.DRAFT_CREATED,
          timestamp: '2026-01-01T00:00:00Z',
          actorUserId: 'actor-1'
        }
      ]
      const chain = findChain(documents)
      const collection = buildFakeCollection({ find: chain.find })
      const db = buildFakeDb(collection)

      const results = await listCatchHistoryEventsForOwner(db, {
        catchRecordId: 'catch-record-1',
        ownerUserId: 'owner-1',
        limit: 10
      })

      expect(results).toEqual([
        {
          id: 'id-1',
          catchRecordId: 'catch-record-1',
          ownerUserId: 'owner-1',
          eventType: CATCH_HISTORY_EVENT_TYPES.DRAFT_CREATED,
          timestamp: '2026-01-01T00:00:00Z',
          actorUserId: 'actor-1'
        }
      ])
    })

    test('Should reject a limit exceeding MAX_HISTORY_LIST_LIMIT before calling the driver', async () => {
      const chain = findChain([])
      const collection = buildFakeCollection({ find: chain.find })
      const db = buildFakeDb(collection)

      await expect(
        listCatchHistoryEventsForOwner(db, {
          catchRecordId: 'catch-record-1',
          ownerUserId: 'owner-1',
          limit: MAX_HISTORY_LIST_LIMIT + 1
        })
      ).rejects.toThrow(TypeError)

      expect(chain.find).not.toHaveBeenCalled()
    })

    test('Should reject a missing or invalid limit', async () => {
      const chain = findChain([])
      const collection = buildFakeCollection({ find: chain.find })
      const db = buildFakeDb(collection)

      await expect(
        listCatchHistoryEventsForOwner(db, {
          catchRecordId: 'catch-record-1',
          ownerUserId: 'owner-1',
          limit: 0
        })
      ).rejects.toThrow(TypeError)
      expect(chain.find).not.toHaveBeenCalled()
    })

    test('Should reject an operator-shaped catchRecordId before any driver call', async () => {
      const chain = findChain([])
      const collection = buildFakeCollection({ find: chain.find })
      const db = buildFakeDb(collection)

      await expect(
        listCatchHistoryEventsForOwner(db, {
          catchRecordId: { $ne: null },
          ownerUserId: 'owner-1',
          limit: 10
        })
      ).rejects.toThrow(TypeError)
      expect(chain.find).not.toHaveBeenCalled()
    })

    test('Should reject an operator-shaped ownerUserId before any driver call', async () => {
      const chain = findChain([])
      const collection = buildFakeCollection({ find: chain.find })
      const db = buildFakeDb(collection)

      await expect(
        listCatchHistoryEventsForOwner(db, {
          catchRecordId: 'catch-record-1',
          ownerUserId: { $gt: '' },
          limit: 10
        })
      ).rejects.toThrow(TypeError)
      expect(chain.find).not.toHaveBeenCalled()
    })

    test('Should not mutate the caller-supplied options object', async () => {
      const chain = findChain([])
      const collection = buildFakeCollection({ find: chain.find })
      const db = buildFakeDb(collection)
      const options = {
        catchRecordId: 'catch-record-1',
        ownerUserId: 'owner-1',
        limit: 10
      }
      const snapshot = structuredClone(options)

      await listCatchHistoryEventsForOwner(db, options)

      expect(options).toEqual(snapshot)
    })

    test('Should translate an unexpected query failure safely', async () => {
      const toArray = vi.fn().mockRejectedValue(new Error('connection reset'))
      const limit = vi.fn().mockReturnValue({ toArray })
      const sort = vi.fn().mockReturnValue({ limit })
      const find = vi.fn().mockReturnValue({ sort })
      const collection = buildFakeCollection({ find })
      const db = buildFakeDb(collection)

      await expect(
        listCatchHistoryEventsForOwner(db, {
          catchRecordId: 'catch-record-1',
          ownerUserId: 'owner-1',
          limit: 10
        })
      ).rejects.toMatchObject({
        category: 'UNEXPECTED_INTERNAL_FAILURE',
        code: 'CATCH_RECORD_HISTORY_PERSISTENCE_FAILURE'
      })
    })

    test('Should translate a malformed stored document safely', async () => {
      const chain = findChain([{ _id: 'id-1' }])
      const collection = buildFakeCollection({ find: chain.find })
      const db = buildFakeDb(collection)

      await expect(
        listCatchHistoryEventsForOwner(db, {
          catchRecordId: 'catch-record-1',
          ownerUserId: 'owner-1',
          limit: 10
        })
      ).rejects.toMatchObject({
        category: 'UNEXPECTED_INTERNAL_FAILURE',
        code: 'MALFORMED_HISTORY_EVENT_DOCUMENT'
      })
    })
  })
})
