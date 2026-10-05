import {
  claimIdempotency,
  completeIdempotencyClaim,
  IDEMPOTENCY_CLAIM_OUTCOMES
} from './catch-idempotency-persistence.js'
import { IDEMPOTENCY_OPERATION_SCOPES } from './idempotency-operation-scope.js'
import { computeRequestFingerprint } from './idempotency-fingerprint.js'

const FINGERPRINT = computeRequestFingerprint({
  operationScope: IDEMPOTENCY_OPERATION_SCOPES.DRAFT_CREATION,
  idempotencyKey: 'client-key-1',
  allowedFields: ['vesselId'],
  semanticInput: { vesselId: 'V1' }
})

const OTHER_FINGERPRINT = computeRequestFingerprint({
  operationScope: IDEMPOTENCY_OPERATION_SCOPES.DRAFT_CREATION,
  idempotencyKey: 'client-key-1',
  allowedFields: ['vesselId'],
  semanticInput: { vesselId: 'V2' }
})

function buildFakeCollection(overrides = {}) {
  return {
    insertOne: vi.fn().mockResolvedValue({ acknowledged: true }),
    findOne: vi.fn().mockResolvedValue(null),
    findOneAndUpdate: vi.fn().mockResolvedValue(null),
    ...overrides
  }
}

function buildFakeDb(collection) {
  return { collection: vi.fn().mockReturnValue(collection) }
}

function duplicateKeyError() {
  const error = new Error('E11000 duplicate key error')
  error.code = 11000
  return error
}

function buildClaimParams(overrides = {}) {
  return {
    ownerUserId: 'owner-1',
    operationScope: IDEMPOTENCY_OPERATION_SCOPES.DRAFT_CREATION,
    idempotencyKey: 'client-key-1',
    fingerprint: FINGERPRINT,
    ...overrides
  }
}

describe('#catch-idempotency-persistence', () => {
  describe('claimIdempotency', () => {
    test('Should insert exactly one PENDING claim document and return CLAIMED', async () => {
      const collection = buildFakeCollection()
      const db = buildFakeDb(collection)

      const result = await claimIdempotency(db, buildClaimParams())

      expect(db.collection).toHaveBeenCalledExactlyOnceWith(
        'catch-idempotency-claims'
      )
      expect(collection.insertOne).toHaveBeenCalledExactlyOnceWith({
        ownerUserId: 'owner-1',
        operationScope: IDEMPOTENCY_OPERATION_SCOPES.DRAFT_CREATION,
        idempotencyKey: 'client-key-1',
        resourceId: '\u0000NO_RESOURCE\u0000',
        fingerprint: FINGERPRINT,
        state: 'PENDING',
        createdAt: expect.any(String)
      })
      expect(result).toEqual({ outcome: IDEMPOTENCY_CLAIM_OUTCOMES.CLAIMED })
    })

    test('Should not mutate the caller-supplied params object', async () => {
      const collection = buildFakeCollection()
      const db = buildFakeDb(collection)
      const params = buildClaimParams({ resourceId: 'catch-record-1' })
      const snapshot = { ...params }

      await claimIdempotency(db, params)

      expect(params).toEqual(snapshot)
    })

    test('Should normalise an explicit resourceId onto the inserted document', async () => {
      const collection = buildFakeCollection()
      const db = buildFakeDb(collection)

      await claimIdempotency(
        db,
        buildClaimParams({ resourceId: 'catch-record-1' })
      )

      expect(collection.insertOne).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ resourceId: 'catch-record-1' })
      )
    })

    test.each([
      ['ownerUserId', { ownerUserId: undefined }],
      ['ownerUserId', { ownerUserId: '' }],
      ['operationScope', { operationScope: 'NOT_A_SCOPE' }],
      ['idempotencyKey', { idempotencyKey: '' }],
      ['fingerprint', { fingerprint: 'not-a-fingerprint' }],
      ['resourceId', { resourceId: 'has\u0000nul' }]
    ])(
      'Should reject an invalid %s before any Mongo call',
      async (_field, overrides) => {
        const collection = buildFakeCollection()
        const db = buildFakeDb(collection)

        await expect(
          claimIdempotency(db, buildClaimParams(overrides))
        ).rejects.toThrow(TypeError)
        expect(collection.insertOne).not.toHaveBeenCalled()
      }
    )

    test('Should return REPLAY with an independent result copy when a matching COMPLETED claim exists', async () => {
      const storedResult = { catchRecordId: 'cr-1' }
      const collection = buildFakeCollection({
        insertOne: vi.fn().mockRejectedValue(duplicateKeyError()),
        findOne: vi.fn().mockResolvedValue({
          fingerprint: FINGERPRINT,
          state: 'COMPLETED',
          result: storedResult
        })
      })
      const db = buildFakeDb(collection)

      const result = await claimIdempotency(db, buildClaimParams())

      expect(result.outcome).toBe(IDEMPOTENCY_CLAIM_OUTCOMES.REPLAY)
      expect(result.result).toEqual(storedResult)
      expect(result.result).not.toBe(storedResult)

      // An independent, frozen copy: an attempt to mutate the returned result must never affect the
      // stored object (and must itself fail, since it is frozen).
      expect(Object.isFrozen(result.result)).toBe(true)
      expect(() => {
        result.result.catchRecordId = 'mutated'
      }).toThrow(TypeError)
      expect(storedResult.catchRecordId).toBe('cr-1')
    })

    test('Should return IN_PROGRESS when a matching PENDING claim exists', async () => {
      const collection = buildFakeCollection({
        insertOne: vi.fn().mockRejectedValue(duplicateKeyError()),
        findOne: vi.fn().mockResolvedValue({
          fingerprint: FINGERPRINT,
          state: 'PENDING'
        })
      })
      const db = buildFakeDb(collection)

      const result = await claimIdempotency(db, buildClaimParams())

      expect(result).toEqual({
        outcome: IDEMPOTENCY_CLAIM_OUTCOMES.IN_PROGRESS
      })
    })

    test('Should throw IDEMPOTENCY_CONFLICT when an existing claim has a different fingerprint', async () => {
      const collection = buildFakeCollection({
        insertOne: vi.fn().mockRejectedValue(duplicateKeyError()),
        findOne: vi.fn().mockResolvedValue({
          fingerprint: OTHER_FINGERPRINT,
          state: 'PENDING'
        })
      })
      const db = buildFakeDb(collection)

      await expect(
        claimIdempotency(db, buildClaimParams())
      ).rejects.toMatchObject({
        category: 'IDEMPOTENCY_CONFLICT',
        code: 'IDEMPOTENCY_REQUEST_MISMATCH'
      })
    })

    test('Should throw an unexpected-persistence error when the classification read unexpectedly finds nothing', async () => {
      const collection = buildFakeCollection({
        insertOne: vi.fn().mockRejectedValue(duplicateKeyError()),
        findOne: vi.fn().mockResolvedValue(null)
      })
      const db = buildFakeDb(collection)

      await expect(
        claimIdempotency(db, buildClaimParams())
      ).rejects.toMatchObject({
        category: 'UNEXPECTED_INTERNAL_FAILURE',
        code: 'IDEMPOTENCY_PERSISTENCE_FAILURE'
      })
    })

    test('Should translate a non-duplicate-key insert failure into an unexpected-persistence error', async () => {
      const collection = buildFakeCollection({
        insertOne: vi.fn().mockRejectedValue(new Error('connection reset'))
      })
      const db = buildFakeDb(collection)

      await expect(
        claimIdempotency(db, buildClaimParams())
      ).rejects.toMatchObject({
        category: 'UNEXPECTED_INTERNAL_FAILURE',
        code: 'IDEMPOTENCY_PERSISTENCE_FAILURE'
      })
    })

    test('Should translate a classification-read driver failure into an unexpected-persistence error', async () => {
      const collection = buildFakeCollection({
        insertOne: vi.fn().mockRejectedValue(duplicateKeyError()),
        findOne: vi.fn().mockRejectedValue(new Error('connection reset'))
      })
      const db = buildFakeDb(collection)

      await expect(
        claimIdempotency(db, buildClaimParams())
      ).rejects.toMatchObject({
        category: 'UNEXPECTED_INTERNAL_FAILURE',
        code: 'IDEMPOTENCY_PERSISTENCE_FAILURE'
      })
    })

    test('Should throw a safe malformed-document error when a matching COMPLETED claim has a non-object stored result', async () => {
      const collection = buildFakeCollection({
        insertOne: vi.fn().mockRejectedValue(duplicateKeyError()),
        findOne: vi.fn().mockResolvedValue({
          fingerprint: FINGERPRINT,
          state: 'COMPLETED',
          result: 'not-an-object'
        })
      })
      const db = buildFakeDb(collection)

      await expect(
        claimIdempotency(db, buildClaimParams())
      ).rejects.toMatchObject({
        category: 'UNEXPECTED_INTERNAL_FAILURE',
        code: 'MALFORMED_IDEMPOTENCY_CLAIM_DOCUMENT'
      })
    })
  })

  describe('completeIdempotencyClaim', () => {
    function buildCompleteParams(overrides = {}) {
      return {
        ownerUserId: 'owner-1',
        operationScope: IDEMPOTENCY_OPERATION_SCOPES.DRAFT_CREATION,
        idempotencyKey: 'client-key-1',
        fingerprint: FINGERPRINT,
        result: { catchRecordId: 'cr-1' },
        allowedResultFields: ['catchRecordId'],
        ...overrides
      }
    }

    test('Should atomically transition a PENDING claim to COMPLETED and return the stored result', async () => {
      const collection = buildFakeCollection({
        findOneAndUpdate: vi
          .fn()
          .mockResolvedValue({ result: { catchRecordId: 'cr-1' } })
      })
      const db = buildFakeDb(collection)

      const result = await completeIdempotencyClaim(db, buildCompleteParams())

      expect(collection.findOneAndUpdate).toHaveBeenCalledExactlyOnceWith(
        {
          ownerUserId: 'owner-1',
          operationScope: IDEMPOTENCY_OPERATION_SCOPES.DRAFT_CREATION,
          idempotencyKey: 'client-key-1',
          resourceId: '\u0000NO_RESOURCE\u0000',
          fingerprint: FINGERPRINT,
          state: 'PENDING'
        },
        {
          $set: {
            state: 'COMPLETED',
            completedAt: expect.any(String),
            result: { catchRecordId: 'cr-1' }
          }
        },
        { returnDocument: 'after' }
      )
      expect(result).toEqual({ catchRecordId: 'cr-1' })
    })

    test('Should not mutate the caller-supplied result object', async () => {
      const collection = buildFakeCollection({
        findOneAndUpdate: vi
          .fn()
          .mockResolvedValue({ result: { catchRecordId: 'cr-1' } })
      })
      const db = buildFakeDb(collection)
      const result = { catchRecordId: 'cr-1' }

      await completeIdempotencyClaim(db, buildCompleteParams({ result }))

      expect(result).toEqual({ catchRecordId: 'cr-1' })
    })

    test.each([
      ['empty result', { result: {} }],
      ['disallowed result field', { result: { somethingElse: 'x' } }],
      ['missing allowedResultFields', { allowedResultFields: undefined }]
    ])(
      'Should reject %s before any Mongo call',
      async (_description, overrides) => {
        const collection = buildFakeCollection()
        const db = buildFakeDb(collection)

        await expect(
          completeIdempotencyClaim(db, buildCompleteParams(overrides))
        ).rejects.toThrow(TypeError)
        expect(collection.findOneAndUpdate).not.toHaveBeenCalled()
      }
    )

    test('Should throw IDEMPOTENCY_CLAIM_NOT_FOUND when no claim exists at all', async () => {
      const collection = buildFakeCollection({
        findOneAndUpdate: vi.fn().mockResolvedValue(null),
        findOne: vi.fn().mockResolvedValue(null)
      })
      const db = buildFakeDb(collection)

      await expect(
        completeIdempotencyClaim(db, buildCompleteParams())
      ).rejects.toMatchObject({
        category: 'UNEXPECTED_INTERNAL_FAILURE',
        code: 'IDEMPOTENCY_CLAIM_NOT_FOUND'
      })
    })

    test('Should throw IDEMPOTENCY_CONFLICT when the existing claim has a different fingerprint', async () => {
      const collection = buildFakeCollection({
        findOneAndUpdate: vi.fn().mockResolvedValue(null),
        findOne: vi.fn().mockResolvedValue({
          fingerprint: OTHER_FINGERPRINT,
          state: 'PENDING'
        })
      })
      const db = buildFakeDb(collection)

      await expect(
        completeIdempotencyClaim(db, buildCompleteParams())
      ).rejects.toMatchObject({
        category: 'IDEMPOTENCY_CONFLICT',
        code: 'IDEMPOTENCY_REQUEST_MISMATCH'
      })
    })

    test('Should deterministically return the existing stored result when already COMPLETED with an identical result', async () => {
      const collection = buildFakeCollection({
        findOneAndUpdate: vi.fn().mockResolvedValue(null),
        findOne: vi.fn().mockResolvedValue({
          fingerprint: FINGERPRINT,
          state: 'COMPLETED',
          result: { catchRecordId: 'cr-1' }
        })
      })
      const db = buildFakeDb(collection)

      const result = await completeIdempotencyClaim(db, buildCompleteParams())

      expect(result).toEqual({ catchRecordId: 'cr-1' })
    })

    test('Should throw IDEMPOTENCY_CONFLICT when already COMPLETED with a different result', async () => {
      const collection = buildFakeCollection({
        findOneAndUpdate: vi.fn().mockResolvedValue(null),
        findOne: vi.fn().mockResolvedValue({
          fingerprint: FINGERPRINT,
          state: 'COMPLETED',
          result: { catchRecordId: 'cr-2' }
        })
      })
      const db = buildFakeDb(collection)

      await expect(
        completeIdempotencyClaim(db, buildCompleteParams())
      ).rejects.toMatchObject({
        category: 'IDEMPOTENCY_CONFLICT',
        code: 'IDEMPOTENCY_REQUEST_MISMATCH'
      })
    })

    test('Should throw IDEMPOTENCY_CONFLICT when already COMPLETED with a result carrying a different field count', async () => {
      const collection = buildFakeCollection({
        findOneAndUpdate: vi.fn().mockResolvedValue(null),
        findOne: vi.fn().mockResolvedValue({
          fingerprint: FINGERPRINT,
          state: 'COMPLETED',
          result: { catchRecordId: 'cr-1', catchRecordReference: 'GBR-1' }
        })
      })
      const db = buildFakeDb(collection)

      await expect(
        completeIdempotencyClaim(db, buildCompleteParams())
      ).rejects.toMatchObject({
        category: 'IDEMPOTENCY_CONFLICT',
        code: 'IDEMPOTENCY_REQUEST_MISMATCH'
      })
    })

    test('Should throw an unexpected-persistence error for an unreachable still-PENDING classification', async () => {
      const collection = buildFakeCollection({
        findOneAndUpdate: vi.fn().mockResolvedValue(null),
        findOne: vi.fn().mockResolvedValue({
          fingerprint: FINGERPRINT,
          state: 'PENDING'
        })
      })
      const db = buildFakeDb(collection)

      await expect(
        completeIdempotencyClaim(db, buildCompleteParams())
      ).rejects.toMatchObject({
        category: 'UNEXPECTED_INTERNAL_FAILURE',
        code: 'IDEMPOTENCY_PERSISTENCE_FAILURE'
      })
    })

    test('Should translate a findOneAndUpdate driver failure into an unexpected-persistence error', async () => {
      const collection = buildFakeCollection({
        findOneAndUpdate: vi
          .fn()
          .mockRejectedValue(new Error('connection reset'))
      })
      const db = buildFakeDb(collection)

      await expect(
        completeIdempotencyClaim(db, buildCompleteParams())
      ).rejects.toMatchObject({
        category: 'UNEXPECTED_INTERNAL_FAILURE',
        code: 'IDEMPOTENCY_PERSISTENCE_FAILURE'
      })
    })

    test('Should translate a classification-read driver failure into an unexpected-persistence error', async () => {
      const collection = buildFakeCollection({
        findOneAndUpdate: vi.fn().mockResolvedValue(null),
        findOne: vi.fn().mockRejectedValue(new Error('connection reset'))
      })
      const db = buildFakeDb(collection)

      await expect(
        completeIdempotencyClaim(db, buildCompleteParams())
      ).rejects.toMatchObject({
        category: 'UNEXPECTED_INTERNAL_FAILURE',
        code: 'IDEMPOTENCY_PERSISTENCE_FAILURE'
      })
    })
  })
})
