import {
  CATCH_RECORD_COLLECTION,
  ensureCatchRecordIndexes,
  getCatchRecordCollection
} from './catch-record-collection.js'

describe('#catch-record-collection', () => {
  test('Should define the approved collection name', () => {
    expect(CATCH_RECORD_COLLECTION).toBe('catch-records')
  })

  test('getCatchRecordCollection should resolve the approved collection name only', () => {
    const collectionSpy = vi.fn().mockReturnValue('the-collection')
    const db = { collection: collectionSpy }

    const result = getCatchRecordCollection(db)

    expect(collectionSpy).toHaveBeenCalledExactlyOnceWith('catch-records')
    expect(result).toBe('the-collection')
  })

  test('ensureCatchRecordIndexes should create exactly the approved indexes', async () => {
    const createIndex = vi.fn().mockResolvedValue(undefined)
    const collection = { createIndex }
    const db = { collection: vi.fn().mockReturnValue(collection) }

    await ensureCatchRecordIndexes(db)

    expect(db.collection).toHaveBeenCalledExactlyOnceWith('catch-records')
    expect(createIndex).toHaveBeenCalledTimes(2)
    expect(createIndex).toHaveBeenNthCalledWith(
      1,
      { catchRecordReference: 1 },
      { unique: true }
    )
    expect(createIndex).toHaveBeenNthCalledWith(2, {
      ownerUserId: 1,
      createdAt: -1,
      _id: 1
    })
  })
})
