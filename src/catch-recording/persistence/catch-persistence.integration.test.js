import { randomUUID } from 'node:crypto'

import { newDraftExample } from '../domain/__fixtures__/canonical-catch-record.fixtures.js'
import {
  applyAuditMetadataUpdate,
  CATCH_RECORD_COLLECTION,
  createCatchRecord,
  findCatchRecordByIdForOwner,
  findCatchRecordByReference,
  listCatchRecordsByOwner
} from './catch-persistence.js'
import { toPersistenceDocument } from './catch-record-mapper.js'

/**
 * Builds an independent, uniquely identified canonical Catch Record for one test, so concurrent/
 * repeated test runs never collide on the unique `_id`/`catchRecordReference` indexes.
 *
 * @param {object} [overrides]
 */
function buildUniqueCatchRecord(overrides = {}) {
  return {
    ...structuredClone(newDraftExample),
    id: randomUUID(),
    catchRecordReference: `GBR-TEST-${randomUUID()}`,
    ...overrides
  }
}

describe('#catch-persistence (MongoDB integration)', () => {
  let server
  let db

  beforeAll(async () => {
    // Dynamic import needed due to config being updated by vitest-mongodb (mirrors
    // `src/plugins/mongodb.test.js`'s existing established pattern).
    const { createServer } = await import('#/server.js')

    server = await createServer()
    await server.initialize()
    db = server.db
  })

  afterAll(async () => {
    await server.stop({ timeout: 1000 })
  })

  afterEach(async () => {
    await db.collection(CATCH_RECORD_COLLECTION).deleteMany({})
  })

  describe('indexes', () => {
    test('Should create the approved indexes idempotently', async () => {
      const indexes = await db.collection(CATCH_RECORD_COLLECTION).indexes()

      const idIndex = indexes.find((index) => index.name === '_id_')
      const referenceIndex = indexes.find(
        (index) => Object.keys(index.key).join() === 'catchRecordReference'
      )
      const ownerListIndex = indexes.find(
        (index) => Object.keys(index.key).join() === 'ownerUserId,createdAt,_id'
      )

      expect(idIndex).toBeDefined()
      expect(referenceIndex).toBeDefined()
      expect(referenceIndex.unique).toBe(true)
      expect(referenceIndex.key).toEqual({ catchRecordReference: 1 })
      expect(ownerListIndex).toBeDefined()
      expect(ownerListIndex.key).toEqual({
        ownerUserId: 1,
        createdAt: -1,
        _id: 1
      })

      // Re-running index creation must not error or create a duplicate index.
      const { ensureCatchRecordIndexes } =
        await import('./catch-record-collection.js')
      await expect(ensureCatchRecordIndexes(db)).resolves.toBeUndefined()

      const indexesAfterRerun = await db
        .collection(CATCH_RECORD_COLLECTION)
        .indexes()
      expect(indexesAfterRerun).toHaveLength(indexes.length)
    })
  })

  describe('create and owner-scoped retrieval round trip', () => {
    test('Should create exactly one document and retrieve it for its owner', async () => {
      const record = buildUniqueCatchRecord()

      const created = await createCatchRecord(db, record)
      expect(created).toEqual(record)

      const documentCount = await db
        .collection(CATCH_RECORD_COLLECTION)
        .countDocuments({ _id: record.id })
      expect(documentCount).toBe(1)

      const found = await findCatchRecordByIdForOwner(db, {
        id: record.id,
        ownerUserId: record.ownerUserId
      })
      expect(found).toEqual(record)
    })

    test('Should return the approved safe not-found outcome for a cross-owner lookup', async () => {
      const record = buildUniqueCatchRecord()
      await createCatchRecord(db, record)

      const found = await findCatchRecordByIdForOwner(db, {
        id: record.id,
        ownerUserId: 'a-completely-different-owner'
      })

      expect(found).toBeNull()
    })

    test('Should fail deterministically on a duplicate internal ID', async () => {
      const record = buildUniqueCatchRecord()
      await createCatchRecord(db, record)

      const duplicateIdRecord = buildUniqueCatchRecord({ id: record.id })

      await expect(
        createCatchRecord(db, duplicateIdRecord)
      ).rejects.toMatchObject({
        category: 'DUPLICATE_RESOURCE',
        code: 'DUPLICATE_CATCH_RECORD_ID'
      })
    })

    test('Should fail deterministically on a duplicate friendly reference', async () => {
      const record = buildUniqueCatchRecord()
      await createCatchRecord(db, record)

      const duplicateReferenceRecord = buildUniqueCatchRecord({
        catchRecordReference: record.catchRecordReference
      })

      await expect(
        createCatchRecord(db, duplicateReferenceRecord)
      ).rejects.toMatchObject({
        category: 'DUPLICATE_RESOURCE',
        code: 'DUPLICATE_CATCH_RECORD_REFERENCE'
      })
    })
  })

  describe('findCatchRecordByReference', () => {
    test('Should retrieve the exact matching record', async () => {
      const record = buildUniqueCatchRecord()
      await createCatchRecord(db, record)

      const found = await findCatchRecordByReference(db, {
        catchRecordReference: record.catchRecordReference
      })

      expect(found).toEqual(record)
    })

    test('Should return the safe not-found outcome for an unknown reference', async () => {
      const found = await findCatchRecordByReference(db, {
        catchRecordReference: 'GBR-DOES-NOT-EXIST-000000-000000'
      })

      expect(found).toBeNull()
    })
  })

  describe('applyAuditMetadataUpdate', () => {
    test('Should atomically update only the allowed audit fields for the owner-scoped record', async () => {
      const record = buildUniqueCatchRecord()
      await createCatchRecord(db, record)

      const updated = await applyAuditMetadataUpdate(db, {
        id: record.id,
        ownerUserId: record.ownerUserId,
        expectedVersion: record.version,
        changes: { updatedAt: '2026-03-01T00:00:00Z', updatedBy: 'user-99' }
      })

      expect(updated.updatedAt).toBe('2026-03-01T00:00:00Z')
      expect(updated.updatedBy).toBe('user-99')
      // Everything else is untouched except the exact single version increment.
      expect(updated.status).toBe(record.status)
      expect(updated.version).toBe(record.version + 1)
    })

    test('Should increment version exactly once and change only the allow-listed fields plus version', async () => {
      const record = buildUniqueCatchRecord()
      await createCatchRecord(db, record)

      await applyAuditMetadataUpdate(db, {
        id: record.id,
        ownerUserId: record.ownerUserId,
        expectedVersion: record.version,
        changes: { updatedAt: '2026-03-01T00:00:00Z', updatedBy: 'user-99' }
      })

      const storedDocument = await db
        .collection(CATCH_RECORD_COLLECTION)
        .findOne({ _id: record.id })

      expect(storedDocument.version).toBe(record.version + 1)
      expect(storedDocument.updatedAt).toBe('2026-03-01T00:00:00Z')
      expect(storedDocument.updatedBy).toBe('user-99')
      // Every other stored field is unchanged.
      const { version, updatedAt, updatedBy, ...unchangedFields } =
        storedDocument
      const originalDocument = toPersistenceDocument(record)
      const {
        version: originalVersion,
        updatedAt: originalUpdatedAt,
        updatedBy: originalUpdatedBy,
        ...originalUnchangedFields
      } = originalDocument
      expect(unchangedFields).toEqual(originalUnchangedFields)
    })

    test('Should fail with a deterministic VERSION_CONFLICT on a stale expected version, leaving the stored document unchanged', async () => {
      const record = buildUniqueCatchRecord()
      await createCatchRecord(db, record)

      // Consume the current expected version with a real, successful update first.
      await applyAuditMetadataUpdate(db, {
        id: record.id,
        ownerUserId: record.ownerUserId,
        expectedVersion: record.version,
        changes: { updatedAt: '2026-03-01T00:00:00Z', updatedBy: 'user-99' }
      })

      // The original expected version is now stale.
      await expect(
        applyAuditMetadataUpdate(db, {
          id: record.id,
          ownerUserId: record.ownerUserId,
          expectedVersion: record.version,
          changes: { updatedAt: '2026-04-01T00:00:00Z', updatedBy: 'user-100' }
        })
      ).rejects.toMatchObject({
        category: 'VERSION_CONFLICT',
        code: 'CATCH_RECORD_VERSION_CONFLICT'
      })

      const storedDocument = await db
        .collection(CATCH_RECORD_COLLECTION)
        .findOne({ _id: record.id })

      // The second (rejected) attempt did not change the document at all.
      expect(storedDocument.version).toBe(record.version + 1)
      expect(storedDocument.updatedAt).toBe('2026-03-01T00:00:00Z')
      expect(storedDocument.updatedBy).toBe('user-99')
    })

    test('Should allow exactly one of two concurrent writes using the same expected version to succeed', async () => {
      const record = buildUniqueCatchRecord()
      await createCatchRecord(db, record)

      const results = await Promise.allSettled([
        applyAuditMetadataUpdate(db, {
          id: record.id,
          ownerUserId: record.ownerUserId,
          expectedVersion: record.version,
          changes: { updatedAt: '2026-05-01T00:00:00Z', updatedBy: 'user-a' }
        }),
        applyAuditMetadataUpdate(db, {
          id: record.id,
          ownerUserId: record.ownerUserId,
          expectedVersion: record.version,
          changes: { updatedAt: '2026-05-02T00:00:00Z', updatedBy: 'user-b' }
        })
      ])

      const fulfilled = results.filter(
        (result) => result.status === 'fulfilled'
      )
      const rejected = results.filter((result) => result.status === 'rejected')

      expect(fulfilled).toHaveLength(1)
      expect(rejected).toHaveLength(1)
      expect(rejected[0].reason).toMatchObject({
        category: 'VERSION_CONFLICT',
        code: 'CATCH_RECORD_VERSION_CONFLICT'
      })

      const storedDocument = await db
        .collection(CATCH_RECORD_COLLECTION)
        .findOne({ _id: record.id })

      // Exactly one increment happened, never two.
      expect(storedDocument.version).toBe(record.version + 1)
    })

    test('Should distinguish a genuinely missing record (null) from a version conflict (thrown)', async () => {
      const record = buildUniqueCatchRecord()
      await createCatchRecord(db, record)

      const missingResult = await applyAuditMetadataUpdate(db, {
        id: randomUUID(),
        ownerUserId: record.ownerUserId,
        expectedVersion: 1,
        changes: { updatedAt: '2026-06-01T00:00:00Z', updatedBy: 'user-1' }
      })
      expect(missingResult).toBeNull()

      await expect(
        applyAuditMetadataUpdate(db, {
          id: record.id,
          ownerUserId: record.ownerUserId,
          expectedVersion: record.version + 1, // never a valid current version yet
          changes: { updatedAt: '2026-06-01T00:00:00Z', updatedBy: 'user-1' }
        })
      ).rejects.toMatchObject({ category: 'VERSION_CONFLICT' })
    })

    test('Should return the safe not-found outcome (not a conflict) for a cross-owner update attempt', async () => {
      const record = buildUniqueCatchRecord()
      await createCatchRecord(db, record)

      const result = await applyAuditMetadataUpdate(db, {
        id: record.id,
        ownerUserId: 'a-completely-different-owner',
        expectedVersion: record.version,
        changes: { updatedAt: '2026-03-01T00:00:00Z', updatedBy: 'user-99' }
      })

      expect(result).toBeNull()

      const storedDocument = await db
        .collection(CATCH_RECORD_COLLECTION)
        .findOne({ _id: record.id })
      expect(storedDocument.version).toBe(record.version)
    })
  })

  describe('listCatchRecordsByOwner', () => {
    test('Should return only the owner-scoped, bounded, deterministically ordered records', async () => {
      const ownerUserId = `owner-${randomUUID()}`
      const first = buildUniqueCatchRecord({
        ownerUserId,
        createdAt: '2026-01-01T00:00:00Z'
      })
      const second = buildUniqueCatchRecord({
        ownerUserId,
        createdAt: '2026-01-02T00:00:00Z'
      })
      const otherOwnerRecord = buildUniqueCatchRecord()

      await createCatchRecord(db, first)
      await createCatchRecord(db, second)
      await createCatchRecord(db, otherOwnerRecord)

      const results = await listCatchRecordsByOwner(db, {
        ownerUserId,
        limit: 10
      })

      expect(results).toHaveLength(2)
      // Newest-first.
      expect(results[0].id).toBe(second.id)
      expect(results[1].id).toBe(first.id)
      expect(results.every((item) => item.ownerUserId === ownerUserId)).toBe(
        true
      )
    })

    test('Should bound the result set by the supplied limit', async () => {
      const ownerUserId = `owner-${randomUUID()}`
      await createCatchRecord(db, buildUniqueCatchRecord({ ownerUserId }))
      await createCatchRecord(db, buildUniqueCatchRecord({ ownerUserId }))
      await createCatchRecord(db, buildUniqueCatchRecord({ ownerUserId }))

      const results = await listCatchRecordsByOwner(db, {
        ownerUserId,
        limit: 2
      })

      expect(results).toHaveLength(2)
    })
  })
})
