import {
  CATCH_HISTORY_COLLECTION,
  getCatchHistoryCollection,
  ensureCatchHistoryIndexes
} from './catch-history-collection.js'

describe('#catch-history-collection', () => {
  describe('CATCH_HISTORY_COLLECTION', () => {
    test('Should be the approved collection name', () => {
      expect(CATCH_HISTORY_COLLECTION).toBe('catch-record-history')
    })
  })

  describe('getCatchHistoryCollection', () => {
    test('Should resolve the approved collection from the supplied db handle', () => {
      const collection = { name: 'fake-collection' }
      const db = { collection: vi.fn().mockReturnValue(collection) }

      const result = getCatchHistoryCollection(db)

      expect(db.collection).toHaveBeenCalledExactlyOnceWith(
        'catch-record-history'
      )
      expect(result).toBe(collection)
    })
  })

  describe('ensureCatchHistoryIndexes', () => {
    test('Should create exactly the one documented compound index', async () => {
      const createIndex = vi.fn().mockResolvedValue('index-name')
      const collection = { createIndex }
      const db = { collection: vi.fn().mockReturnValue(collection) }

      await ensureCatchHistoryIndexes(db)

      expect(createIndex).toHaveBeenCalledExactlyOnceWith({
        catchRecordId: 1,
        ownerUserId: 1,
        timestamp: 1,
        _id: 1
      })
    })
  })
})
