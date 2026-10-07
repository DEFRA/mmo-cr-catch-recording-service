import {
  applyAuditMetadataUpdate,
  applyCompleteReplacement,
  applyCompletion,
  applyEditStart,
  applySectionUpdate,
  applySubmission,
  createCatchRecord,
  deleteEligibleDraftForOwner,
  findCatchRecordById,
  findCatchRecordByIdForOwner,
  findCatchRecordByReference,
  listCatchRecordsByOwner,
  MAX_LIST_LIMIT
} from './catch-persistence.js'
import {
  newDraftExample,
  submittedExample,
  completeExample
} from '../domain/__fixtures__/canonical-catch-record.fixtures.js'
import { toPersistenceDocument } from './catch-record-mapper.js'

function buildFakeCollection(overrides = {}) {
  return {
    insertOne: vi.fn().mockResolvedValue({ acknowledged: true }),
    findOne: vi.fn().mockResolvedValue(null),
    findOneAndDelete: vi.fn().mockResolvedValue(null),
    findOneAndUpdate: vi.fn().mockResolvedValue(null),
    find: vi.fn(),
    ...overrides
  }
}

function buildFakeDb(collection) {
  return { collection: vi.fn().mockReturnValue(collection) }
}

function duplicateKeyError(keyPattern) {
  const error = new Error('E11000 duplicate key error')
  error.code = 11000
  error.keyPattern = keyPattern
  return error
}

describe('#catch-persistence', () => {
  describe('createCatchRecord', () => {
    test('Should insert exactly one mapped document and return the mapped canonical record', async () => {
      const collection = buildFakeCollection()
      const db = buildFakeDb(collection)

      const result = await createCatchRecord(db, newDraftExample)

      expect(db.collection).toHaveBeenCalledExactlyOnceWith('catch-records')
      expect(collection.insertOne).toHaveBeenCalledExactlyOnceWith(
        toPersistenceDocument(newDraftExample)
      )
      expect(result).toEqual(newDraftExample)
    })

    test('Should not mutate the caller-supplied canonical record', async () => {
      const collection = buildFakeCollection()
      const db = buildFakeDb(collection)
      const record = structuredClone(newDraftExample)
      const snapshot = structuredClone(record)

      await createCatchRecord(db, record)

      expect(record).toEqual(snapshot)
    })

    test('Should translate a duplicate _id into DUPLICATE_RESOURCE', async () => {
      const collection = buildFakeCollection({
        insertOne: vi.fn().mockRejectedValue(duplicateKeyError({ _id: 1 }))
      })
      const db = buildFakeDb(collection)

      await expect(
        createCatchRecord(db, newDraftExample)
      ).rejects.toMatchObject({
        category: 'DUPLICATE_RESOURCE',
        code: 'DUPLICATE_CATCH_RECORD_ID'
      })
    })

    test('Should translate a duplicate catchRecordReference into DUPLICATE_RESOURCE', async () => {
      const collection = buildFakeCollection({
        insertOne: vi
          .fn()
          .mockRejectedValue(duplicateKeyError({ catchRecordReference: 1 }))
      })
      const db = buildFakeDb(collection)

      await expect(
        createCatchRecord(db, newDraftExample)
      ).rejects.toMatchObject({
        category: 'DUPLICATE_RESOURCE',
        code: 'DUPLICATE_CATCH_RECORD_REFERENCE'
      })
    })

    test('Should translate any other insert failure safely', async () => {
      const collection = buildFakeCollection({
        insertOne: vi.fn().mockRejectedValue(new Error('connection reset'))
      })
      const db = buildFakeDb(collection)

      await expect(
        createCatchRecord(db, newDraftExample)
      ).rejects.toMatchObject({
        category: 'UNEXPECTED_INTERNAL_FAILURE',
        code: 'CATCH_RECORD_PERSISTENCE_FAILURE'
      })
    })
  })

  describe('findCatchRecordByIdForOwner', () => {
    test('Should include ownerUserId in the MongoDB filter and return the mapped record on match', async () => {
      const document = toPersistenceDocument(newDraftExample)
      const collection = buildFakeCollection({
        findOne: vi.fn().mockResolvedValue(document)
      })
      const db = buildFakeDb(collection)

      const result = await findCatchRecordByIdForOwner(db, {
        id: newDraftExample.id,
        ownerUserId: newDraftExample.ownerUserId
      })

      expect(collection.findOne).toHaveBeenCalledExactlyOnceWith({
        _id: newDraftExample.id,
        ownerUserId: newDraftExample.ownerUserId
      })
      expect(result).toEqual(newDraftExample)
    })

    test('Should return null (safe not-found) for a cross-owner lookup', async () => {
      const collection = buildFakeCollection({
        findOne: vi.fn().mockResolvedValue(null)
      })
      const db = buildFakeDb(collection)

      const result = await findCatchRecordByIdForOwner(db, {
        id: newDraftExample.id,
        ownerUserId: 'a-different-owner'
      })

      expect(result).toBeNull()
    })

    test('Should return null for a missing id', async () => {
      const collection = buildFakeCollection({
        findOne: vi.fn().mockResolvedValue(null)
      })
      const db = buildFakeDb(collection)

      const result = await findCatchRecordByIdForOwner(db, {
        id: 'does-not-exist',
        ownerUserId: newDraftExample.ownerUserId
      })

      expect(result).toBeNull()
    })

    test('Should reject an operator-injection id before calling the driver', async () => {
      const collection = buildFakeCollection()
      const db = buildFakeDb(collection)

      await expect(
        findCatchRecordByIdForOwner(db, {
          id: { $ne: null },
          ownerUserId: newDraftExample.ownerUserId
        })
      ).rejects.toThrow(TypeError)

      expect(collection.findOne).not.toHaveBeenCalled()
    })

    test('Should reject an operator-injection ownerUserId before calling the driver', async () => {
      const collection = buildFakeCollection()
      const db = buildFakeDb(collection)

      await expect(
        findCatchRecordByIdForOwner(db, {
          id: newDraftExample.id,
          ownerUserId: { $where: '1==1' }
        })
      ).rejects.toThrow(TypeError)

      expect(collection.findOne).not.toHaveBeenCalled()
    })

    test('Should translate an unexpected driver failure safely', async () => {
      const collection = buildFakeCollection({
        findOne: vi.fn().mockRejectedValue(new Error('connection reset'))
      })
      const db = buildFakeDb(collection)

      await expect(
        findCatchRecordByIdForOwner(db, {
          id: newDraftExample.id,
          ownerUserId: newDraftExample.ownerUserId
        })
      ).rejects.toMatchObject({ category: 'UNEXPECTED_INTERNAL_FAILURE' })
    })

    test('Should fail safely on a malformed stored document rather than exposing it', async () => {
      const collection = buildFakeCollection({
        findOne: vi.fn().mockResolvedValue({ _id: 'x', schemaVersion: 99 })
      })
      const db = buildFakeDb(collection)

      await expect(
        findCatchRecordByIdForOwner(db, {
          id: newDraftExample.id,
          ownerUserId: newDraftExample.ownerUserId
        })
      ).rejects.toMatchObject({
        category: 'UNEXPECTED_INTERNAL_FAILURE',
        code: 'MALFORMED_CATCH_RECORD_DOCUMENT'
      })
    })
  })

  describe('findCatchRecordByReference', () => {
    test('Should perform an exact-match lookup and return the mapped record', async () => {
      const document = toPersistenceDocument(newDraftExample)
      const collection = buildFakeCollection({
        findOne: vi.fn().mockResolvedValue(document)
      })
      const db = buildFakeDb(collection)

      const result = await findCatchRecordByReference(db, {
        catchRecordReference: newDraftExample.catchRecordReference
      })

      expect(collection.findOne).toHaveBeenCalledExactlyOnceWith({
        catchRecordReference: newDraftExample.catchRecordReference
      })
      expect(result).toEqual(newDraftExample)
    })

    test('Should return null when no reference matches', async () => {
      const collection = buildFakeCollection({
        findOne: vi.fn().mockResolvedValue(null)
      })
      const db = buildFakeDb(collection)

      const result = await findCatchRecordByReference(db, {
        catchRecordReference: 'GBR-DOES-NOT-EXIST'
      })

      expect(result).toBeNull()
    })

    test('Should reject a regular-expression-shaped reference before calling the driver', async () => {
      const collection = buildFakeCollection()
      const db = buildFakeDb(collection)

      await expect(
        findCatchRecordByReference(db, {
          catchRecordReference: { $regex: '.*' }
        })
      ).rejects.toThrow(TypeError)

      expect(collection.findOne).not.toHaveBeenCalled()
    })

    test('Should translate an unexpected driver failure safely', async () => {
      const collection = buildFakeCollection({
        findOne: vi.fn().mockRejectedValue(new Error('connection reset'))
      })
      const db = buildFakeDb(collection)

      await expect(
        findCatchRecordByReference(db, {
          catchRecordReference: newDraftExample.catchRecordReference
        })
      ).rejects.toMatchObject({ category: 'UNEXPECTED_INTERNAL_FAILURE' })
    })
  })

  describe('applyAuditMetadataUpdate', () => {
    const changes = { updatedAt: '2026-02-01T00:00:00Z', updatedBy: 'user-2' }
    const expectedVersion = newDraftExample.version

    test('Should atomically match id/owner/version and $inc version by exactly 1 in one call', async () => {
      const updatedDocument = {
        ...toPersistenceDocument(newDraftExample),
        ...changes,
        version: expectedVersion + 1
      }
      const collection = buildFakeCollection({
        findOneAndUpdate: vi.fn().mockResolvedValue(updatedDocument)
      })
      const db = buildFakeDb(collection)

      const result = await applyAuditMetadataUpdate(db, {
        id: newDraftExample.id,
        ownerUserId: newDraftExample.ownerUserId,
        expectedVersion,
        changes
      })

      expect(collection.findOneAndUpdate).toHaveBeenCalledExactlyOnceWith(
        {
          _id: newDraftExample.id,
          ownerUserId: newDraftExample.ownerUserId,
          version: expectedVersion
        },
        { $set: changes, $inc: { version: 1 } },
        { returnDocument: 'after' }
      )
      expect(result.updatedAt).toBe(changes.updatedAt)
      expect(result.updatedBy).toBe(changes.updatedBy)
      expect(result.version).toBe(expectedVersion + 1)
    })

    test('Should not mutate the supplied changes object', async () => {
      const suppliedChanges = { ...changes }
      const updatedDocument = {
        ...toPersistenceDocument(newDraftExample),
        ...changes,
        version: expectedVersion + 1
      }
      const collection = buildFakeCollection({
        findOneAndUpdate: vi.fn().mockResolvedValue(updatedDocument)
      })
      const db = buildFakeDb(collection)

      await applyAuditMetadataUpdate(db, {
        id: newDraftExample.id,
        ownerUserId: newDraftExample.ownerUserId,
        expectedVersion,
        changes: suppliedChanges
      })

      expect(suppliedChanges).toEqual(changes)
    })

    test('Should return null (safe not-found) when the record does not exist for this owner at all', async () => {
      const collection = buildFakeCollection({
        findOneAndUpdate: vi.fn().mockResolvedValue(null),
        findOne: vi.fn().mockResolvedValue(null)
      })
      const db = buildFakeDb(collection)

      const result = await applyAuditMetadataUpdate(db, {
        id: 'does-not-exist',
        ownerUserId: newDraftExample.ownerUserId,
        expectedVersion,
        changes
      })

      expect(result).toBeNull()
    })

    test('Should return the same safe not-found outcome (not a conflict) for a cross-owner attempt', async () => {
      const collection = buildFakeCollection({
        findOneAndUpdate: vi.fn().mockResolvedValue(null),
        // The owner-scoped classification read itself finds nothing for the wrong owner.
        findOne: vi.fn().mockResolvedValue(null)
      })
      const db = buildFakeDb(collection)

      const result = await applyAuditMetadataUpdate(db, {
        id: newDraftExample.id,
        ownerUserId: 'a-different-owner',
        expectedVersion,
        changes
      })

      expect(result).toBeNull()
      expect(collection.findOne).toHaveBeenCalledExactlyOnceWith(
        { _id: newDraftExample.id, ownerUserId: 'a-different-owner' },
        { projection: { _id: 1 } }
      )
    })

    test('Should throw a deterministic VERSION_CONFLICT when the owner-scoped record exists but the version was stale', async () => {
      const collection = buildFakeCollection({
        findOneAndUpdate: vi.fn().mockResolvedValue(null),
        // The owner-scoped classification read finds the record: version, not ownership/existence, is
        // the reason the atomic update above did not match.
        findOne: vi.fn().mockResolvedValue({ _id: newDraftExample.id })
      })
      const db = buildFakeDb(collection)

      await expect(
        applyAuditMetadataUpdate(db, {
          id: newDraftExample.id,
          ownerUserId: newDraftExample.ownerUserId,
          expectedVersion,
          changes
        })
      ).rejects.toMatchObject({
        category: 'VERSION_CONFLICT',
        code: 'CATCH_RECORD_VERSION_CONFLICT'
      })

      // The classification read must not re-apply the version predicate — only identity and owner.
      expect(collection.findOne).toHaveBeenCalledExactlyOnceWith(
        { _id: newDraftExample.id, ownerUserId: newDraftExample.ownerUserId },
        { projection: { _id: 1 } }
      )
    })

    test.each([
      ['missing', undefined],
      ['negative', -1],
      ['zero', 0],
      ['fractional', 1.5],
      ['a numeric string', '1'],
      ['an object', { version: 1 }]
    ])(
      'Should reject %s expectedVersion before calling the driver',
      async (_description, invalidExpectedVersion) => {
        const collection = buildFakeCollection()
        const db = buildFakeDb(collection)

        await expect(
          applyAuditMetadataUpdate(db, {
            id: newDraftExample.id,
            ownerUserId: newDraftExample.ownerUserId,
            expectedVersion: invalidExpectedVersion,
            changes
          })
        ).rejects.toThrow(TypeError)

        expect(collection.findOneAndUpdate).not.toHaveBeenCalled()
      }
    )

    test('Should reject a disallowed/server-owned field before calling the driver', async () => {
      const collection = buildFakeCollection()
      const db = buildFakeDb(collection)

      await expect(
        applyAuditMetadataUpdate(db, {
          id: newDraftExample.id,
          ownerUserId: newDraftExample.ownerUserId,
          expectedVersion,
          changes: { ...changes, version: 99 }
        })
      ).rejects.toThrow(TypeError)

      expect(collection.findOneAndUpdate).not.toHaveBeenCalled()
    })

    test('Should reject direct caller assignment of version via changes, even alone', async () => {
      const collection = buildFakeCollection()
      const db = buildFakeDb(collection)

      await expect(
        applyAuditMetadataUpdate(db, {
          id: newDraftExample.id,
          ownerUserId: newDraftExample.ownerUserId,
          expectedVersion,
          changes: { version: 99 }
        })
      ).rejects.toThrow(TypeError)

      expect(collection.findOneAndUpdate).not.toHaveBeenCalled()
    })

    test('Should reject a raw MongoDB update operator before calling the driver', async () => {
      const collection = buildFakeCollection()
      const db = buildFakeDb(collection)

      await expect(
        applyAuditMetadataUpdate(db, {
          id: newDraftExample.id,
          ownerUserId: newDraftExample.ownerUserId,
          expectedVersion,
          changes: { $set: { updatedAt: 'x' } }
        })
      ).rejects.toThrow(TypeError)

      expect(collection.findOneAndUpdate).not.toHaveBeenCalled()
    })

    test('Should translate an unexpected driver failure on findOneAndUpdate safely', async () => {
      const collection = buildFakeCollection({
        findOneAndUpdate: vi
          .fn()
          .mockRejectedValue(new Error('connection reset'))
      })
      const db = buildFakeDb(collection)

      await expect(
        applyAuditMetadataUpdate(db, {
          id: newDraftExample.id,
          ownerUserId: newDraftExample.ownerUserId,
          expectedVersion,
          changes
        })
      ).rejects.toMatchObject({ category: 'UNEXPECTED_INTERNAL_FAILURE' })
    })

    test('Should translate an unexpected driver failure on the classification read safely', async () => {
      const collection = buildFakeCollection({
        findOneAndUpdate: vi.fn().mockResolvedValue(null),
        findOne: vi.fn().mockRejectedValue(new Error('connection reset'))
      })
      const db = buildFakeDb(collection)

      await expect(
        applyAuditMetadataUpdate(db, {
          id: newDraftExample.id,
          ownerUserId: newDraftExample.ownerUserId,
          expectedVersion,
          changes
        })
      ).rejects.toMatchObject({ category: 'UNEXPECTED_INTERNAL_FAILURE' })
    })
  })

  describe('listCatchRecordsByOwner', () => {
    function buildFindChain(documents) {
      const toArray = vi.fn().mockResolvedValue(documents)
      const limit = vi.fn().mockReturnValue({ toArray })
      const sort = vi.fn().mockReturnValue({ limit })
      return { find: vi.fn().mockReturnValue({ sort }), sort, limit, toArray }
    }

    test('Should query owner-scoped only, sorted deterministically, bounded by limit', async () => {
      const document = toPersistenceDocument(newDraftExample)
      const chain = buildFindChain([document])
      const collection = buildFakeCollection({ find: chain.find })
      const db = buildFakeDb(collection)

      const result = await listCatchRecordsByOwner(db, {
        ownerUserId: newDraftExample.ownerUserId,
        limit: 10
      })

      expect(chain.find).toHaveBeenCalledExactlyOnceWith({
        ownerUserId: newDraftExample.ownerUserId
      })
      expect(chain.sort).toHaveBeenCalledExactlyOnceWith({
        createdAt: -1,
        _id: 1
      })
      expect(chain.limit).toHaveBeenCalledExactlyOnceWith(10)
      expect(result).toEqual([newDraftExample])
    })

    test('Should reject a limit exceeding MAX_LIST_LIMIT before calling the driver', async () => {
      const chain = buildFindChain([])
      const collection = buildFakeCollection({ find: chain.find })
      const db = buildFakeDb(collection)

      await expect(
        listCatchRecordsByOwner(db, {
          ownerUserId: newDraftExample.ownerUserId,
          limit: MAX_LIST_LIMIT + 1
        })
      ).rejects.toThrow(TypeError)

      expect(chain.find).not.toHaveBeenCalled()
    })

    test('Should reject a missing or invalid limit', async () => {
      const chain = buildFindChain([])
      const collection = buildFakeCollection({ find: chain.find })
      const db = buildFakeDb(collection)

      await expect(
        listCatchRecordsByOwner(db, {
          ownerUserId: newDraftExample.ownerUserId
        })
      ).rejects.toThrow(TypeError)
    })

    test('Should reject an operator-injection ownerUserId before calling the driver', async () => {
      const chain = buildFindChain([])
      const collection = buildFakeCollection({ find: chain.find })
      const db = buildFakeDb(collection)

      await expect(
        listCatchRecordsByOwner(db, { ownerUserId: { $ne: null }, limit: 10 })
      ).rejects.toThrow(TypeError)

      expect(chain.find).not.toHaveBeenCalled()
    })

    test('Should return an empty array when the owner has no records', async () => {
      const chain = buildFindChain([])
      const collection = buildFakeCollection({ find: chain.find })
      const db = buildFakeDb(collection)

      const result = await listCatchRecordsByOwner(db, {
        ownerUserId: 'owner-with-no-records',
        limit: 10
      })

      expect(result).toEqual([])
    })

    test('Should apply an approved persisted-status filter to the owner-scoped predicate', async () => {
      const chain = buildFindChain([])
      const collection = buildFakeCollection({ find: chain.find })
      const db = buildFakeDb(collection)

      await listCatchRecordsByOwner(db, {
        ownerUserId: newDraftExample.ownerUserId,
        limit: 10,
        status: 'SUBMITTED'
      })

      expect(chain.find).toHaveBeenCalledExactlyOnceWith({
        ownerUserId: newDraftExample.ownerUserId,
        status: 'SUBMITTED'
      })
    })

    test('Should reject an unsupported status filter before calling the driver', async () => {
      const chain = buildFindChain([])
      const collection = buildFakeCollection({ find: chain.find })
      const db = buildFakeDb(collection)

      await expect(
        listCatchRecordsByOwner(db, {
          ownerUserId: newDraftExample.ownerUserId,
          limit: 10,
          status: 'AMENDED'
        })
      ).rejects.toThrow(TypeError)

      expect(chain.find).not.toHaveBeenCalled()
    })

    test('Should translate an unexpected driver failure safely', async () => {
      const toArray = vi.fn().mockRejectedValue(new Error('connection reset'))
      const limit = vi.fn().mockReturnValue({ toArray })
      const sort = vi.fn().mockReturnValue({ limit })
      const find = vi.fn().mockReturnValue({ sort })
      const collection = buildFakeCollection({ find })
      const db = buildFakeDb(collection)

      await expect(
        listCatchRecordsByOwner(db, {
          ownerUserId: newDraftExample.ownerUserId,
          limit: 10
        })
      ).rejects.toMatchObject({ category: 'UNEXPECTED_INTERNAL_FAILURE' })
    })
  })

  describe('applySectionUpdate', () => {
    const expectedVersion = newDraftExample.version
    const allowedFields = ['trip', 'pairFishing']
    const changes = {
      updatedAt: '2026-10-06T00:00:00.000Z',
      updatedBy: newDraftExample.ownerUserId,
      trip: { startedAndFinishedToday: true }
    }

    test('Should atomically match id/owner/version, $set the section plus audit fields, and $inc version by exactly 1', async () => {
      const updatedDocument = {
        ...toPersistenceDocument(newDraftExample),
        ...changes,
        version: expectedVersion + 1
      }
      const collection = buildFakeCollection({
        findOneAndUpdate: vi.fn().mockResolvedValue(updatedDocument)
      })
      const db = buildFakeDb(collection)

      const result = await applySectionUpdate(db, {
        id: newDraftExample.id,
        ownerUserId: newDraftExample.ownerUserId,
        expectedVersion,
        changes,
        allowedFields
      })

      expect(collection.findOneAndUpdate).toHaveBeenCalledExactlyOnceWith(
        {
          _id: newDraftExample.id,
          ownerUserId: newDraftExample.ownerUserId,
          status: 'DRAFT',
          version: expectedVersion
        },
        { $set: changes, $inc: { version: 1 } },
        { returnDocument: 'after' }
      )
      expect(result.version).toBe(expectedVersion + 1)
    })

    test('Should return null (safe not-found) when the record does not exist for this owner at all', async () => {
      const collection = buildFakeCollection({
        findOneAndUpdate: vi.fn().mockResolvedValue(null),
        findOne: vi.fn().mockResolvedValue(null)
      })
      const db = buildFakeDb(collection)

      const result = await applySectionUpdate(db, {
        id: 'does-not-exist',
        ownerUserId: newDraftExample.ownerUserId,
        expectedVersion,
        changes,
        allowedFields
      })

      expect(result).toBeNull()
    })

    test('Should throw CATCH_RECORD_SECTION_UPDATE_INELIGIBLE when the record exists but is not DRAFT', async () => {
      const collection = buildFakeCollection({
        findOneAndUpdate: vi.fn().mockResolvedValue(null),
        findOne: vi.fn().mockResolvedValue({ status: 'SUBMITTED' })
      })
      const db = buildFakeDb(collection)

      await expect(
        applySectionUpdate(db, {
          id: newDraftExample.id,
          ownerUserId: newDraftExample.ownerUserId,
          expectedVersion,
          changes,
          allowedFields
        })
      ).rejects.toMatchObject({
        category: 'INVALID_LIFECYCLE_TRANSITION',
        code: 'CATCH_RECORD_SECTION_UPDATE_INELIGIBLE'
      })
    })

    test('Should throw a deterministic VERSION_CONFLICT when the owner-scoped record exists, is DRAFT, but the version was stale', async () => {
      const collection = buildFakeCollection({
        findOneAndUpdate: vi.fn().mockResolvedValue(null),
        findOne: vi
          .fn()
          .mockResolvedValue({ _id: newDraftExample.id, status: 'DRAFT' })
      })
      const db = buildFakeDb(collection)

      await expect(
        applySectionUpdate(db, {
          id: newDraftExample.id,
          ownerUserId: newDraftExample.ownerUserId,
          expectedVersion,
          changes,
          allowedFields
        })
      ).rejects.toMatchObject({
        category: 'VERSION_CONFLICT',
        code: 'CATCH_RECORD_VERSION_CONFLICT'
      })
    })

    test('Should reject a section field that is not allow-listed before calling the driver', async () => {
      const collection = buildFakeCollection()
      const db = buildFakeDb(collection)

      await expect(
        applySectionUpdate(db, {
          id: newDraftExample.id,
          ownerUserId: newDraftExample.ownerUserId,
          expectedVersion,
          changes: {
            updatedAt: changes.updatedAt,
            updatedBy: changes.updatedBy,
            gears: []
          },
          allowedFields
        })
      ).rejects.toThrow(TypeError)

      expect(collection.findOneAndUpdate).not.toHaveBeenCalled()
    })

    test('Should reject more than one section field before calling the driver', async () => {
      const collection = buildFakeCollection()
      const db = buildFakeDb(collection)

      await expect(
        applySectionUpdate(db, {
          id: newDraftExample.id,
          ownerUserId: newDraftExample.ownerUserId,
          expectedVersion,
          changes: { ...changes, pairFishing: { enabled: false } },
          allowedFields
        })
      ).rejects.toThrow(TypeError)

      expect(collection.findOneAndUpdate).not.toHaveBeenCalled()
    })

    test('Should translate an unexpected driver failure on findOneAndUpdate safely', async () => {
      const collection = buildFakeCollection({
        findOneAndUpdate: vi
          .fn()
          .mockRejectedValue(new Error('connection reset'))
      })
      const db = buildFakeDb(collection)

      await expect(
        applySectionUpdate(db, {
          id: newDraftExample.id,
          ownerUserId: newDraftExample.ownerUserId,
          expectedVersion,
          changes,
          allowedFields
        })
      ).rejects.toMatchObject({ category: 'UNEXPECTED_INTERNAL_FAILURE' })
    })
  })

  describe('deleteEligibleDraftForOwner', () => {
    const expectedVersion = newDraftExample.version

    test('Should atomically match id/owner/eligible-draft predicate/version in one findOneAndDelete call', async () => {
      const deletedDocument = toPersistenceDocument(newDraftExample)
      const collection = buildFakeCollection({
        findOneAndDelete: vi.fn().mockResolvedValue(deletedDocument)
      })
      const db = buildFakeDb(collection)

      const result = await deleteEligibleDraftForOwner(db, {
        id: newDraftExample.id,
        ownerUserId: newDraftExample.ownerUserId,
        expectedVersion
      })

      expect(collection.findOneAndDelete).toHaveBeenCalledExactlyOnceWith({
        _id: newDraftExample.id,
        ownerUserId: newDraftExample.ownerUserId,
        status: 'DRAFT',
        numberOfSubmissions: 0,
        submittedAt: null,
        submittedBy: null,
        version: expectedVersion
      })
      expect(result.id).toBe(newDraftExample.id)
    })

    test('Should return null (idempotent, safe) when nothing matches and no record exists for this owner at all', async () => {
      const collection = buildFakeCollection({
        findOneAndDelete: vi.fn().mockResolvedValue(null),
        findOne: vi.fn().mockResolvedValue(null)
      })
      const db = buildFakeDb(collection)

      const result = await deleteEligibleDraftForOwner(db, {
        id: 'does-not-exist',
        ownerUserId: newDraftExample.ownerUserId,
        expectedVersion
      })

      expect(result).toBeNull()
    })

    test('Should return the same safe null outcome for a cross-owner attempt (no disclosure)', async () => {
      const collection = buildFakeCollection({
        findOneAndDelete: vi.fn().mockResolvedValue(null),
        findOne: vi.fn().mockResolvedValue(null)
      })
      const db = buildFakeDb(collection)

      const result = await deleteEligibleDraftForOwner(db, {
        id: newDraftExample.id,
        ownerUserId: 'a-different-owner',
        expectedVersion
      })

      expect(result).toBeNull()
    })

    test('Should return null for a repeated abandonment of an already-deleted draft (deterministic idempotency)', async () => {
      const collection = buildFakeCollection({
        findOneAndDelete: vi.fn().mockResolvedValue(null),
        findOne: vi.fn().mockResolvedValue(null)
      })
      const db = buildFakeDb(collection)

      const first = await deleteEligibleDraftForOwner(db, {
        id: newDraftExample.id,
        ownerUserId: newDraftExample.ownerUserId,
        expectedVersion
      })
      const second = await deleteEligibleDraftForOwner(db, {
        id: newDraftExample.id,
        ownerUserId: newDraftExample.ownerUserId,
        expectedVersion
      })

      expect(first).toBeNull()
      expect(second).toBeNull()
    })

    test('Should throw INVALID_LIFECYCLE_TRANSITION when the record exists but is not an eligible never-submitted draft', async () => {
      const collection = buildFakeCollection({
        findOneAndDelete: vi.fn().mockResolvedValue(null),
        findOne: vi.fn().mockResolvedValue({
          _id: newDraftExample.id,
          status: 'SUBMITTED',
          numberOfSubmissions: 1,
          submittedAt: '2026-10-05T12:15:00Z',
          submittedBy: newDraftExample.ownerUserId
        })
      })
      const db = buildFakeDb(collection)

      await expect(
        deleteEligibleDraftForOwner(db, {
          id: newDraftExample.id,
          ownerUserId: newDraftExample.ownerUserId,
          expectedVersion
        })
      ).rejects.toMatchObject({
        category: 'INVALID_LIFECYCLE_TRANSITION',
        code: 'CATCH_RECORD_ABANDONMENT_INELIGIBLE'
      })
    })

    test('Should throw VERSION_CONFLICT when the record is an eligible draft but the version was stale', async () => {
      const collection = buildFakeCollection({
        findOneAndDelete: vi.fn().mockResolvedValue(null),
        findOne: vi.fn().mockResolvedValue({
          _id: newDraftExample.id,
          status: 'DRAFT',
          numberOfSubmissions: 0,
          submittedAt: null,
          submittedBy: null
        })
      })
      const db = buildFakeDb(collection)

      await expect(
        deleteEligibleDraftForOwner(db, {
          id: newDraftExample.id,
          ownerUserId: newDraftExample.ownerUserId,
          expectedVersion
        })
      ).rejects.toMatchObject({
        category: 'VERSION_CONFLICT',
        code: 'CATCH_RECORD_VERSION_CONFLICT'
      })
    })

    test.each([
      ['missing', undefined],
      ['negative', -1],
      ['zero', 0],
      ['fractional', 1.5]
    ])(
      'Should reject %s expectedVersion before calling the driver',
      async (_description, invalidExpectedVersion) => {
        const collection = buildFakeCollection()
        const db = buildFakeDb(collection)

        await expect(
          deleteEligibleDraftForOwner(db, {
            id: newDraftExample.id,
            ownerUserId: newDraftExample.ownerUserId,
            expectedVersion: invalidExpectedVersion
          })
        ).rejects.toThrow(TypeError)

        expect(collection.findOneAndDelete).not.toHaveBeenCalled()
      }
    )

    test('Should translate an unexpected driver failure on findOneAndDelete safely', async () => {
      const collection = buildFakeCollection({
        findOneAndDelete: vi
          .fn()
          .mockRejectedValue(new Error('connection reset'))
      })
      const db = buildFakeDb(collection)

      await expect(
        deleteEligibleDraftForOwner(db, {
          id: newDraftExample.id,
          ownerUserId: newDraftExample.ownerUserId,
          expectedVersion
        })
      ).rejects.toMatchObject({ category: 'UNEXPECTED_INTERNAL_FAILURE' })
    })

    test('Should translate an unexpected driver failure on the classification read safely', async () => {
      const collection = buildFakeCollection({
        findOneAndDelete: vi.fn().mockResolvedValue(null),
        findOne: vi.fn().mockRejectedValue(new Error('connection reset'))
      })
      const db = buildFakeDb(collection)

      await expect(
        deleteEligibleDraftForOwner(db, {
          id: newDraftExample.id,
          ownerUserId: newDraftExample.ownerUserId,
          expectedVersion
        })
      ).rejects.toMatchObject({ category: 'UNEXPECTED_INTERNAL_FAILURE' })
    })
  })

  describe('applyCompleteReplacement', () => {
    const expectedVersion = newDraftExample.version

    function replacementChanges() {
      return {
        updatedAt: '2026-10-06T10:00:00Z',
        updatedBy: newDraftExample.ownerUserId,
        vessel: newDraftExample.vessel,
        trip: newDraftExample.trip,
        pairFishing: newDraftExample.pairFishing,
        gears: newDraftExample.gears,
        speciesNotLanded: newDraftExample.speciesNotLanded
      }
    }

    test('Should atomically match id/owner/DRAFT/version in one findOneAndUpdate call, incrementing version once', async () => {
      const changes = replacementChanges()
      const updatedDocument = {
        ...toPersistenceDocument(newDraftExample),
        ...changes,
        version: expectedVersion + 1
      }
      const collection = buildFakeCollection({
        findOneAndUpdate: vi.fn().mockResolvedValue(updatedDocument)
      })
      const db = buildFakeDb(collection)

      const result = await applyCompleteReplacement(db, {
        id: newDraftExample.id,
        ownerUserId: newDraftExample.ownerUserId,
        expectedVersion,
        changes
      })

      expect(collection.findOneAndUpdate).toHaveBeenCalledExactlyOnceWith(
        {
          _id: newDraftExample.id,
          ownerUserId: newDraftExample.ownerUserId,
          status: 'DRAFT',
          version: expectedVersion
        },
        { $set: { ...changes }, $inc: { version: 1 } },
        { returnDocument: 'after' }
      )
      expect(result.version).toBe(expectedVersion + 1)
    })

    test('Should reject changes missing an approved section field before calling the driver', async () => {
      const collection = buildFakeCollection()
      const db = buildFakeDb(collection)
      const { speciesNotLanded: _omitted, ...incompleteChanges } =
        replacementChanges()

      await expect(
        applyCompleteReplacement(db, {
          id: newDraftExample.id,
          ownerUserId: newDraftExample.ownerUserId,
          expectedVersion,
          changes: incompleteChanges
        })
      ).rejects.toThrow(TypeError)

      expect(collection.findOneAndUpdate).not.toHaveBeenCalled()
    })

    test('Should reject a non-allow-listed change field before calling the driver', async () => {
      const collection = buildFakeCollection()
      const db = buildFakeDb(collection)

      await expect(
        applyCompleteReplacement(db, {
          id: newDraftExample.id,
          ownerUserId: newDraftExample.ownerUserId,
          expectedVersion,
          changes: { ...replacementChanges(), status: 'SUBMITTED' }
        })
      ).rejects.toThrow(TypeError)

      expect(collection.findOneAndUpdate).not.toHaveBeenCalled()
    })

    test('Should return null (no disclosure) when nothing matches and no record exists for this owner at all', async () => {
      const collection = buildFakeCollection({
        findOneAndUpdate: vi.fn().mockResolvedValue(null),
        findOne: vi.fn().mockResolvedValue(null)
      })
      const db = buildFakeDb(collection)

      const result = await applyCompleteReplacement(db, {
        id: 'does-not-exist',
        ownerUserId: newDraftExample.ownerUserId,
        expectedVersion,
        changes: replacementChanges()
      })

      expect(result).toBeNull()
    })

    test('Should throw INVALID_LIFECYCLE_TRANSITION when the record exists for this owner but is not DRAFT', async () => {
      const collection = buildFakeCollection({
        findOneAndUpdate: vi.fn().mockResolvedValue(null),
        findOne: vi.fn().mockResolvedValue({
          _id: newDraftExample.id,
          status: 'SUBMITTED'
        })
      })
      const db = buildFakeDb(collection)

      await expect(
        applyCompleteReplacement(db, {
          id: newDraftExample.id,
          ownerUserId: newDraftExample.ownerUserId,
          expectedVersion,
          changes: replacementChanges()
        })
      ).rejects.toMatchObject({
        category: 'INVALID_LIFECYCLE_TRANSITION',
        code: 'CATCH_RECORD_REPLACEMENT_INELIGIBLE'
      })
    })

    test('Should throw VERSION_CONFLICT when the record exists for this owner, is DRAFT, but the version no longer matches', async () => {
      const collection = buildFakeCollection({
        findOneAndUpdate: vi.fn().mockResolvedValue(null),
        findOne: vi.fn().mockResolvedValue({
          _id: newDraftExample.id,
          status: 'DRAFT'
        })
      })
      const db = buildFakeDb(collection)

      await expect(
        applyCompleteReplacement(db, {
          id: newDraftExample.id,
          ownerUserId: newDraftExample.ownerUserId,
          expectedVersion,
          changes: replacementChanges()
        })
      ).rejects.toMatchObject({ category: 'VERSION_CONFLICT' })
    })

    test('Should translate an unexpected driver failure safely', async () => {
      const collection = buildFakeCollection({
        findOneAndUpdate: vi
          .fn()
          .mockRejectedValue(new Error('connection reset'))
      })
      const db = buildFakeDb(collection)

      await expect(
        applyCompleteReplacement(db, {
          id: newDraftExample.id,
          ownerUserId: newDraftExample.ownerUserId,
          expectedVersion,
          changes: replacementChanges()
        })
      ).rejects.toMatchObject({ category: 'UNEXPECTED_INTERNAL_FAILURE' })
    })
  })

  describe('applySubmission', () => {
    const expectedVersion = newDraftExample.version

    function submissionParams(overrides = {}) {
      return {
        id: newDraftExample.id,
        ownerUserId: newDraftExample.ownerUserId,
        expectedVersion,
        submissionNumber: 1,
        artifacts: [
          { submissionNumber: 1, type: 'JSON_SNAPSHOT' },
          { submissionNumber: 1, type: 'PDF_RECEIPT' }
        ],
        submittedAt: '2026-10-07T09:00:00Z',
        submittedBy: newDraftExample.ownerUserId,
        updatedAt: '2026-10-07T09:00:00Z',
        updatedBy: newDraftExample.ownerUserId,
        ...overrides
      }
    }

    test('Should atomically match id/owner/DRAFT/version, committing SUBMITTED and incrementing version once', async () => {
      const params = submissionParams()
      const updatedDocument = {
        ...toPersistenceDocument(newDraftExample),
        status: 'SUBMITTED',
        numberOfSubmissions: params.submissionNumber,
        hasUnsubmittedChanges: false,
        artifacts: params.artifacts,
        submittedAt: params.submittedAt,
        submittedBy: params.submittedBy,
        updatedAt: params.updatedAt,
        updatedBy: params.updatedBy,
        version: expectedVersion + 1
      }
      const collection = buildFakeCollection({
        findOneAndUpdate: vi.fn().mockResolvedValue(updatedDocument)
      })
      const db = buildFakeDb(collection)

      const result = await applySubmission(db, params)

      expect(collection.findOneAndUpdate).toHaveBeenCalledExactlyOnceWith(
        {
          _id: newDraftExample.id,
          ownerUserId: newDraftExample.ownerUserId,
          status: 'DRAFT',
          version: expectedVersion
        },
        {
          $set: {
            status: 'SUBMITTED',
            numberOfSubmissions: params.submissionNumber,
            hasUnsubmittedChanges: false,
            artifacts: params.artifacts,
            submittedAt: params.submittedAt,
            submittedBy: params.submittedBy,
            updatedAt: params.updatedAt,
            updatedBy: params.updatedBy
          },
          $inc: { version: 1 }
        },
        { returnDocument: 'after' }
      )
      expect(result.status).toBe('SUBMITTED')
      expect(result.version).toBe(expectedVersion + 1)
    })

    test('Should return null when the record does not exist for this owner', async () => {
      const collection = buildFakeCollection({
        findOneAndUpdate: vi.fn().mockResolvedValue(null),
        findOne: vi.fn().mockResolvedValue(null)
      })
      const db = buildFakeDb(collection)

      const result = await applySubmission(db, submissionParams())

      expect(result).toBeNull()
    })

    test('Should throw CATCH_RECORD_SUBMISSION_INELIGIBLE when the record exists but is not DRAFT', async () => {
      const collection = buildFakeCollection({
        findOneAndUpdate: vi.fn().mockResolvedValue(null),
        findOne: vi.fn().mockResolvedValue({ status: 'SUBMITTED' })
      })
      const db = buildFakeDb(collection)

      await expect(
        applySubmission(db, submissionParams())
      ).rejects.toMatchObject({
        category: 'INVALID_LIFECYCLE_TRANSITION',
        code: 'CATCH_RECORD_SUBMISSION_INELIGIBLE'
      })
    })

    test('Should throw VERSION_CONFLICT when the record is DRAFT but the version no longer matches', async () => {
      const collection = buildFakeCollection({
        findOneAndUpdate: vi.fn().mockResolvedValue(null),
        findOne: vi.fn().mockResolvedValue({ status: 'DRAFT' })
      })
      const db = buildFakeDb(collection)

      await expect(
        applySubmission(db, submissionParams())
      ).rejects.toMatchObject({ category: 'VERSION_CONFLICT' })
    })

    test('Should reject a non-array artifacts value before calling the driver', async () => {
      const collection = buildFakeCollection()
      const db = buildFakeDb(collection)

      await expect(
        applySubmission(db, submissionParams({ artifacts: 'not-an-array' }))
      ).rejects.toThrow(TypeError)
      expect(collection.findOneAndUpdate).not.toHaveBeenCalled()
    })

    test('Should reject a malformed artifact entry before calling the driver', async () => {
      const collection = buildFakeCollection()
      const db = buildFakeDb(collection)

      await expect(
        applySubmission(
          db,
          submissionParams({ artifacts: [{ type: 'JSON_SNAPSHOT' }] })
        )
      ).rejects.toThrow(TypeError)
      expect(collection.findOneAndUpdate).not.toHaveBeenCalled()
    })

    test('Should reject a zero or negative submission number before calling the driver', async () => {
      const collection = buildFakeCollection()
      const db = buildFakeDb(collection)

      await expect(
        applySubmission(db, submissionParams({ submissionNumber: 0 }))
      ).rejects.toThrow(TypeError)
      expect(collection.findOneAndUpdate).not.toHaveBeenCalled()
    })

    test('Should translate an unexpected driver failure safely', async () => {
      const collection = buildFakeCollection({
        findOneAndUpdate: vi
          .fn()
          .mockRejectedValue(new Error('connection reset'))
      })
      const db = buildFakeDb(collection)

      await expect(
        applySubmission(db, submissionParams())
      ).rejects.toMatchObject({ category: 'UNEXPECTED_INTERNAL_FAILURE' })
    })
  })

  describe('findCatchRecordById', () => {
    test('Should retrieve a record by id regardless of owner (not owner-scoped)', async () => {
      const collection = buildFakeCollection({
        findOne: vi
          .fn()
          .mockResolvedValue(toPersistenceDocument(submittedExample))
      })
      const db = buildFakeDb(collection)

      const result = await findCatchRecordById(db, {
        id: submittedExample.id
      })

      expect(collection.findOne).toHaveBeenCalledExactlyOnceWith({
        _id: submittedExample.id
      })
      expect(result.id).toBe(submittedExample.id)
    })

    test('Should return null when no record exists with this id', async () => {
      const collection = buildFakeCollection({
        findOne: vi.fn().mockResolvedValue(null)
      })
      const db = buildFakeDb(collection)

      expect(await findCatchRecordById(db, { id: 'missing' })).toBeNull()
    })
  })

  describe('applyCompletion', () => {
    const expectedVersion = submittedExample.version

    function completionParams(overrides = {}) {
      return {
        id: submittedExample.id,
        expectedVersion,
        completedAt: '2026-10-07T09:00:00Z',
        completedBy: submittedExample.ownerUserId,
        ...overrides
      }
    }

    test('Should atomically match id/SUBMITTED/version (no owner scoping), committing COMPLETE and incrementing version once', async () => {
      const params = completionParams()
      const updatedDocument = {
        ...toPersistenceDocument(submittedExample),
        status: 'COMPLETE',
        completedAt: params.completedAt,
        completedBy: params.completedBy,
        version: expectedVersion + 1
      }
      const collection = buildFakeCollection({
        findOneAndUpdate: vi.fn().mockResolvedValue(updatedDocument)
      })
      const db = buildFakeDb(collection)

      const result = await applyCompletion(db, params)

      expect(collection.findOneAndUpdate).toHaveBeenCalledExactlyOnceWith(
        {
          _id: submittedExample.id,
          status: 'SUBMITTED',
          version: expectedVersion
        },
        {
          $set: {
            status: 'COMPLETE',
            completedAt: params.completedAt,
            completedBy: params.completedBy,
            updatedAt: params.completedAt,
            updatedBy: params.completedBy
          },
          $inc: { version: 1 }
        },
        { returnDocument: 'after' }
      )
      expect(result.status).toBe('COMPLETE')
      expect(result.version).toBe(expectedVersion + 1)
    })

    test('Should return null when no record exists with this id', async () => {
      const collection = buildFakeCollection({
        findOneAndUpdate: vi.fn().mockResolvedValue(null),
        findOne: vi.fn().mockResolvedValue(null)
      })
      const db = buildFakeDb(collection)

      expect(await applyCompletion(db, completionParams())).toBeNull()
    })

    test('Should throw CATCH_RECORD_COMPLETION_INELIGIBLE when the record exists but is not SUBMITTED', async () => {
      const collection = buildFakeCollection({
        findOneAndUpdate: vi.fn().mockResolvedValue(null),
        findOne: vi.fn().mockResolvedValue({ status: 'DRAFT' })
      })
      const db = buildFakeDb(collection)

      await expect(
        applyCompletion(db, completionParams())
      ).rejects.toMatchObject({
        category: 'INVALID_LIFECYCLE_TRANSITION',
        code: 'CATCH_RECORD_COMPLETION_INELIGIBLE'
      })
    })

    test('Should throw VERSION_CONFLICT when the record is SUBMITTED but the version no longer matches', async () => {
      const collection = buildFakeCollection({
        findOneAndUpdate: vi.fn().mockResolvedValue(null),
        findOne: vi.fn().mockResolvedValue({ status: 'SUBMITTED' })
      })
      const db = buildFakeDb(collection)

      await expect(
        applyCompletion(db, completionParams())
      ).rejects.toMatchObject({ category: 'VERSION_CONFLICT' })
    })

    test('Should reject an invalid expectedVersion before calling the driver', async () => {
      const collection = buildFakeCollection()
      const db = buildFakeDb(collection)

      await expect(
        applyCompletion(db, completionParams({ expectedVersion: 0 }))
      ).rejects.toThrow(TypeError)
      expect(collection.findOneAndUpdate).not.toHaveBeenCalled()
    })

    test('Should translate an unexpected driver failure safely', async () => {
      const collection = buildFakeCollection({
        findOneAndUpdate: vi
          .fn()
          .mockRejectedValue(new Error('connection reset'))
      })
      const db = buildFakeDb(collection)

      await expect(
        applyCompletion(db, completionParams())
      ).rejects.toMatchObject({ category: 'UNEXPECTED_INTERNAL_FAILURE' })
    })
  })

  describe('applyEditStart', () => {
    const expectedVersion = submittedExample.version

    function editStartParams(overrides = {}) {
      return {
        id: submittedExample.id,
        ownerUserId: submittedExample.ownerUserId,
        expectedVersion,
        updatedAt: '2026-10-07T09:00:00Z',
        updatedBy: submittedExample.ownerUserId,
        ...overrides
      }
    }

    test('Should atomically match id/owner/version/eligible-status, committing DRAFT and incrementing version once', async () => {
      const params = editStartParams()
      const updatedDocument = {
        ...toPersistenceDocument(submittedExample),
        status: 'DRAFT',
        hasUnsubmittedChanges: true,
        updatedAt: params.updatedAt,
        updatedBy: params.updatedBy,
        version: expectedVersion + 1
      }
      const collection = buildFakeCollection({
        findOneAndUpdate: vi.fn().mockResolvedValue(updatedDocument)
      })
      const db = buildFakeDb(collection)

      const result = await applyEditStart(db, params)

      expect(collection.findOneAndUpdate).toHaveBeenCalledExactlyOnceWith(
        {
          _id: submittedExample.id,
          ownerUserId: submittedExample.ownerUserId,
          status: { $in: ['SUBMITTED', 'COMPLETE'] },
          version: expectedVersion
        },
        {
          $set: {
            status: 'DRAFT',
            hasUnsubmittedChanges: true,
            updatedAt: params.updatedAt,
            updatedBy: params.updatedBy
          },
          $inc: { version: 1 }
        },
        { returnDocument: 'after' }
      )
      expect(result.status).toBe('DRAFT')
      expect(result.hasUnsubmittedChanges).toBe(true)
      expect(result.version).toBe(expectedVersion + 1)
      // Preserved, never part of the $set.
      expect(result.numberOfSubmissions).toBe(
        submittedExample.numberOfSubmissions
      )
      expect(result.artifacts).toEqual(submittedExample.artifacts)
    })

    test('Should also match an eligible COMPLETE source record', async () => {
      const params = {
        id: completeExample.id,
        ownerUserId: completeExample.ownerUserId,
        expectedVersion: completeExample.version,
        updatedAt: '2026-10-07T09:00:00Z',
        updatedBy: completeExample.ownerUserId
      }
      const updatedDocument = {
        ...toPersistenceDocument(completeExample),
        status: 'DRAFT',
        hasUnsubmittedChanges: true,
        version: completeExample.version + 1
      }
      const collection = buildFakeCollection({
        findOneAndUpdate: vi.fn().mockResolvedValue(updatedDocument)
      })
      const db = buildFakeDb(collection)

      const result = await applyEditStart(db, params)

      expect(result.status).toBe('DRAFT')
      // completedAt/completedBy preserved unchanged, never cleared by edit-start.
      expect(result.completedAt).toBe(completeExample.completedAt)
      expect(result.completedBy).toBe(completeExample.completedBy)
    })

    test('Should return null when the record does not exist for this owner', async () => {
      const collection = buildFakeCollection({
        findOneAndUpdate: vi.fn().mockResolvedValue(null),
        findOne: vi.fn().mockResolvedValue(null)
      })
      const db = buildFakeDb(collection)

      expect(await applyEditStart(db, editStartParams())).toBeNull()
    })

    test('Should throw CATCH_RECORD_EDIT_START_INELIGIBLE for an already-DRAFT record', async () => {
      const collection = buildFakeCollection({
        findOneAndUpdate: vi.fn().mockResolvedValue(null),
        findOne: vi.fn().mockResolvedValue({ status: 'DRAFT' })
      })
      const db = buildFakeDb(collection)

      await expect(applyEditStart(db, editStartParams())).rejects.toMatchObject(
        {
          category: 'INVALID_LIFECYCLE_TRANSITION',
          code: 'CATCH_RECORD_EDIT_START_INELIGIBLE'
        }
      )
    })

    test('Should throw VERSION_CONFLICT when the record is eligible but the version no longer matches', async () => {
      const collection = buildFakeCollection({
        findOneAndUpdate: vi.fn().mockResolvedValue(null),
        findOne: vi.fn().mockResolvedValue({ status: 'SUBMITTED' })
      })
      const db = buildFakeDb(collection)

      await expect(applyEditStart(db, editStartParams())).rejects.toMatchObject(
        { category: 'VERSION_CONFLICT' }
      )
    })

    test('Should translate an unexpected driver failure safely', async () => {
      const collection = buildFakeCollection({
        findOneAndUpdate: vi
          .fn()
          .mockRejectedValue(new Error('connection reset'))
      })
      const db = buildFakeDb(collection)

      await expect(applyEditStart(db, editStartParams())).rejects.toMatchObject(
        { category: 'UNEXPECTED_INTERNAL_FAILURE' }
      )
    })
  })
})
