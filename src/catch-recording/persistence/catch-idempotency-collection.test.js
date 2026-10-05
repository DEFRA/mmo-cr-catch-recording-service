import {
  CATCH_IDEMPOTENCY_COLLECTION,
  getCatchIdempotencyCollection,
  ensureCatchIdempotencyIndexes
} from './catch-idempotency-collection.js'

describe('#catch-idempotency-collection', () => {
  describe('CATCH_IDEMPOTENCY_COLLECTION', () => {
    test('Should be the approved collection name', () => {
      expect(CATCH_IDEMPOTENCY_COLLECTION).toBe('catch-idempotency-claims')
    })
  })

  describe('getCatchIdempotencyCollection', () => {
    test('Should resolve the approved collection from the supplied db handle', () => {
      const collection = { name: 'fake-collection' }
      const db = { collection: vi.fn().mockReturnValue(collection) }

      const result = getCatchIdempotencyCollection(db)

      expect(db.collection).toHaveBeenCalledExactlyOnceWith(
        'catch-idempotency-claims'
      )
      expect(result).toBe(collection)
    })
  })

  describe('ensureCatchIdempotencyIndexes', () => {
    test('Should create exactly the one documented unique compound index', async () => {
      const createIndex = vi.fn().mockResolvedValue('index-name')
      const collection = { createIndex }
      const db = { collection: vi.fn().mockReturnValue(collection) }

      await ensureCatchIdempotencyIndexes(db)

      expect(createIndex).toHaveBeenCalledExactlyOnceWith(
        { ownerUserId: 1, operationScope: 1, idempotencyKey: 1, resourceId: 1 },
        { unique: true }
      )
    })
  })
})
