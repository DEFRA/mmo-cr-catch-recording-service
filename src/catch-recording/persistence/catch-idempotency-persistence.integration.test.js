import { randomUUID } from 'node:crypto'

import {
  claimIdempotency,
  completeIdempotencyClaim,
  IDEMPOTENCY_CLAIM_OUTCOMES,
  CATCH_IDEMPOTENCY_COLLECTION,
  ensureCatchIdempotencyIndexes
} from './catch-idempotency-persistence.js'
import { IDEMPOTENCY_OPERATION_SCOPES } from './idempotency-operation-scope.js'
import { computeRequestFingerprint } from './idempotency-fingerprint.js'

function buildFingerprint(overrides = {}) {
  return computeRequestFingerprint({
    operationScope: IDEMPOTENCY_OPERATION_SCOPES.DRAFT_CREATION,
    idempotencyKey: 'client-key',
    allowedFields: ['vesselId'],
    semanticInput: { vesselId: 'V1' },
    ...overrides
  })
}

/**
 * Builds unique claim params for one test, so concurrent/repeated test runs never collide on the unique
 * `(ownerUserId, operationScope, idempotencyKey, resourceId)` index (mirrors
 * `catch-persistence.integration.test.js`'s `buildUniqueCatchRecord` pattern).
 */
function buildUniqueClaimParams(overrides = {}) {
  const idempotencyKey = `key-${randomUUID()}`
  return {
    ownerUserId: 'owner-1',
    operationScope: IDEMPOTENCY_OPERATION_SCOPES.DRAFT_CREATION,
    idempotencyKey,
    fingerprint: buildFingerprint({ idempotencyKey }),
    ...overrides
  }
}

describe('#catch-idempotency-persistence (MongoDB integration)', () => {
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
    await db.collection(CATCH_IDEMPOTENCY_COLLECTION).deleteMany({})
  })

  describe('indexes', () => {
    test('Should create the one documented unique compound index idempotently', async () => {
      const indexes = await db
        .collection(CATCH_IDEMPOTENCY_COLLECTION)
        .indexes()

      const compoundIndex = indexes.find(
        (index) =>
          Object.keys(index.key).join() ===
          'ownerUserId,operationScope,idempotencyKey,resourceId'
      )

      expect(compoundIndex).toBeDefined()
      expect(compoundIndex.unique).toBe(true)

      // Re-running index creation must not error or create a duplicate index.
      await expect(ensureCatchIdempotencyIndexes(db)).resolves.toBeUndefined()

      const indexesAfterRerun = await db
        .collection(CATCH_IDEMPOTENCY_COLLECTION)
        .indexes()
      expect(indexesAfterRerun).toHaveLength(indexes.length)
    })
  })

  describe('first claim', () => {
    test('Should durably create exactly one claim document', async () => {
      const params = buildUniqueClaimParams()

      const result = await claimIdempotency(db, params)
      expect(result).toEqual({ outcome: IDEMPOTENCY_CLAIM_OUTCOMES.CLAIMED })

      const documentCount = await db
        .collection(CATCH_IDEMPOTENCY_COLLECTION)
        .countDocuments({
          ownerUserId: params.ownerUserId,
          operationScope: params.operationScope,
          idempotencyKey: params.idempotencyKey
        })
      expect(documentCount).toBe(1)
    })
  })

  describe('concurrent first claims', () => {
    test('Should allow exactly one of two concurrent identical-fingerprint claims to be CLAIMED, the other replaying or in-progress — never two durable claims', async () => {
      const params = buildUniqueClaimParams()

      const results = await Promise.allSettled([
        claimIdempotency(db, params),
        claimIdempotency(db, params)
      ])

      const fulfilled = results.filter(
        (result) => result.status === 'fulfilled'
      )
      expect(fulfilled).toHaveLength(2)

      const outcomes = fulfilled.map((result) => result.value.outcome)
      expect(outcomes).toContain(IDEMPOTENCY_CLAIM_OUTCOMES.CLAIMED)
      expect(
        outcomes.filter(
          (outcome) => outcome !== IDEMPOTENCY_CLAIM_OUTCOMES.CLAIMED
        )
      ).toEqual([expect.stringMatching(/REPLAY|IN_PROGRESS/)])

      const documentCount = await db
        .collection(CATCH_IDEMPOTENCY_COLLECTION)
        .countDocuments({
          ownerUserId: params.ownerUserId,
          operationScope: params.operationScope,
          idempotencyKey: params.idempotencyKey
        })
      expect(documentCount).toBe(1)
    })

    test('Should allow exactly one of two concurrent different-fingerprint claims to be CLAIMED, the other rejected with IDEMPOTENCY_CONFLICT — never two durable claims', async () => {
      const idempotencyKey = `key-${randomUUID()}`
      const firstParams = buildUniqueClaimParams({
        idempotencyKey,
        fingerprint: buildFingerprint({
          idempotencyKey,
          semanticInput: { vesselId: 'V1' }
        })
      })
      const secondParams = {
        ...firstParams,
        fingerprint: buildFingerprint({
          idempotencyKey,
          semanticInput: { vesselId: 'V2' }
        })
      }

      const results = await Promise.allSettled([
        claimIdempotency(db, firstParams),
        claimIdempotency(db, secondParams)
      ])

      const fulfilled = results.filter(
        (result) => result.status === 'fulfilled'
      )
      const rejected = results.filter((result) => result.status === 'rejected')

      expect(fulfilled).toHaveLength(1)
      expect(fulfilled[0].value).toEqual({
        outcome: IDEMPOTENCY_CLAIM_OUTCOMES.CLAIMED
      })
      expect(rejected).toHaveLength(1)
      expect(rejected[0].reason).toMatchObject({
        category: 'IDEMPOTENCY_CONFLICT',
        code: 'IDEMPOTENCY_REQUEST_MISMATCH'
      })

      const documentCount = await db
        .collection(CATCH_IDEMPOTENCY_COLLECTION)
        .countDocuments({
          ownerUserId: firstParams.ownerUserId,
          operationScope: firstParams.operationScope,
          idempotencyKey
        })
      expect(documentCount).toBe(1)
    })
  })

  describe('completed-claim replay', () => {
    test('Should return the stored result without a new insert when the same scoped key and fingerprint are reused after completion', async () => {
      const params = buildUniqueClaimParams()
      await claimIdempotency(db, params)
      await completeIdempotencyClaim(db, {
        ...params,
        result: { catchRecordId: 'cr-1' },
        allowedResultFields: ['catchRecordId']
      })

      const replay = await claimIdempotency(db, params)

      expect(replay).toEqual({
        outcome: IDEMPOTENCY_CLAIM_OUTCOMES.REPLAY,
        result: { catchRecordId: 'cr-1' }
      })

      const documentCount = await db
        .collection(CATCH_IDEMPOTENCY_COLLECTION)
        .countDocuments({
          ownerUserId: params.ownerUserId,
          operationScope: params.operationScope,
          idempotencyKey: params.idempotencyKey
        })
      expect(documentCount).toBe(1)
    })
  })

  describe('matching still-pending claim', () => {
    test('Should return IN_PROGRESS without a new insert when a claim is not yet completed', async () => {
      const params = buildUniqueClaimParams()
      await claimIdempotency(db, params)

      const second = await claimIdempotency(db, params)

      expect(second).toEqual({
        outcome: IDEMPOTENCY_CLAIM_OUTCOMES.IN_PROGRESS
      })

      const documentCount = await db
        .collection(CATCH_IDEMPOTENCY_COLLECTION)
        .countDocuments({
          ownerUserId: params.ownerUserId,
          operationScope: params.operationScope,
          idempotencyKey: params.idempotencyKey
        })
      expect(documentCount).toBe(1)
    })
  })

  describe('same-key different-fingerprint conflict', () => {
    test('Should throw IDEMPOTENCY_CONFLICT and leave the original claim unchanged', async () => {
      const idempotencyKey = `key-${randomUUID()}`
      const params = buildUniqueClaimParams({
        idempotencyKey,
        fingerprint: buildFingerprint({ idempotencyKey })
      })
      await claimIdempotency(db, params)

      const conflictingFingerprint = buildFingerprint({
        idempotencyKey,
        semanticInput: { vesselId: 'DIFFERENT' }
      })

      await expect(
        claimIdempotency(db, { ...params, fingerprint: conflictingFingerprint })
      ).rejects.toMatchObject({
        category: 'IDEMPOTENCY_CONFLICT',
        code: 'IDEMPOTENCY_REQUEST_MISMATCH'
      })

      const storedDocument = await db
        .collection(CATCH_IDEMPOTENCY_COLLECTION)
        .findOne({ ownerUserId: params.ownerUserId, idempotencyKey })
      expect(storedDocument.fingerprint).toBe(params.fingerprint)
    })
  })

  describe('isolation', () => {
    test('Should not collide or leak across different owners using the identical key, scope, resource, and fingerprint', async () => {
      const shared = buildUniqueClaimParams()

      const firstOwnerResult = await claimIdempotency(db, {
        ...shared,
        ownerUserId: 'owner-a'
      })
      const secondOwnerResult = await claimIdempotency(db, {
        ...shared,
        ownerUserId: 'owner-b'
      })

      expect(firstOwnerResult).toEqual({
        outcome: IDEMPOTENCY_CLAIM_OUTCOMES.CLAIMED
      })
      expect(secondOwnerResult).toEqual({
        outcome: IDEMPOTENCY_CLAIM_OUTCOMES.CLAIMED
      })

      const documentCount = await db
        .collection(CATCH_IDEMPOTENCY_COLLECTION)
        .countDocuments({
          operationScope: shared.operationScope,
          idempotencyKey: shared.idempotencyKey
        })
      expect(documentCount).toBe(2)
    })

    test('Should not collide across different operation scopes using the identical owner, key, resource, and fingerprint', async () => {
      const idempotencyKey = `key-${randomUUID()}`
      const draftParams = {
        ownerUserId: 'owner-1',
        operationScope: IDEMPOTENCY_OPERATION_SCOPES.DRAFT_CREATION,
        idempotencyKey,
        fingerprint: buildFingerprint({ idempotencyKey })
      }
      const submissionParams = {
        ...draftParams,
        operationScope: IDEMPOTENCY_OPERATION_SCOPES.SUBMISSION,
        fingerprint: buildFingerprint({
          idempotencyKey,
          operationScope: IDEMPOTENCY_OPERATION_SCOPES.SUBMISSION
        })
      }

      const draftResult = await claimIdempotency(db, draftParams)
      const submissionResult = await claimIdempotency(db, submissionParams)

      expect(draftResult).toEqual({
        outcome: IDEMPOTENCY_CLAIM_OUTCOMES.CLAIMED
      })
      expect(submissionResult).toEqual({
        outcome: IDEMPOTENCY_CLAIM_OUTCOMES.CLAIMED
      })

      const documentCount = await db
        .collection(CATCH_IDEMPOTENCY_COLLECTION)
        .countDocuments({ ownerUserId: 'owner-1', idempotencyKey })
      expect(documentCount).toBe(2)
    })

    test('Should not collide across different resources using the identical owner, scope, key, and fingerprint', async () => {
      const idempotencyKey = `key-${randomUUID()}`
      const fingerprint = buildFingerprint({ idempotencyKey })
      const baseParams = {
        ownerUserId: 'owner-1',
        operationScope: IDEMPOTENCY_OPERATION_SCOPES.EDIT_START,
        idempotencyKey,
        fingerprint
      }

      const firstResourceResult = await claimIdempotency(db, {
        ...baseParams,
        resourceId: 'catch-record-a'
      })
      const secondResourceResult = await claimIdempotency(db, {
        ...baseParams,
        resourceId: 'catch-record-b'
      })

      expect(firstResourceResult).toEqual({
        outcome: IDEMPOTENCY_CLAIM_OUTCOMES.CLAIMED
      })
      expect(secondResourceResult).toEqual({
        outcome: IDEMPOTENCY_CLAIM_OUTCOMES.CLAIMED
      })

      const documentCount = await db
        .collection(CATCH_IDEMPOTENCY_COLLECTION)
        .countDocuments({ ownerUserId: 'owner-1', idempotencyKey })
      expect(documentCount).toBe(2)
    })
  })

  describe('fingerprint excludes an injected secret field end-to-end', () => {
    test('Should replay (not conflict) when two claims differ only in an excluded field never passed into the fingerprint', async () => {
      const idempotencyKey = `key-${randomUUID()}`
      const allowedFields = ['vesselId']
      const rawRequestA = { vesselId: 'V1', token: 'secret-a' }
      const rawRequestB = { vesselId: 'V1', token: 'secret-b' }

      const extractAllowed = (rawRequest) =>
        Object.fromEntries(
          allowedFields.map((field) => [field, rawRequest[field]])
        )

      const fingerprintA = computeRequestFingerprint({
        operationScope: IDEMPOTENCY_OPERATION_SCOPES.DRAFT_CREATION,
        idempotencyKey,
        allowedFields,
        semanticInput: extractAllowed(rawRequestA)
      })
      const fingerprintB = computeRequestFingerprint({
        operationScope: IDEMPOTENCY_OPERATION_SCOPES.DRAFT_CREATION,
        idempotencyKey,
        allowedFields,
        semanticInput: extractAllowed(rawRequestB)
      })

      expect(fingerprintA).toBe(fingerprintB)

      const params = {
        ownerUserId: 'owner-1',
        operationScope: IDEMPOTENCY_OPERATION_SCOPES.DRAFT_CREATION,
        idempotencyKey,
        fingerprint: fingerprintA
      }

      const first = await claimIdempotency(db, params)
      const second = await claimIdempotency(db, {
        ...params,
        fingerprint: fingerprintB
      })

      expect(first).toEqual({ outcome: IDEMPOTENCY_CLAIM_OUTCOMES.CLAIMED })
      expect(second).toEqual({
        outcome: IDEMPOTENCY_CLAIM_OUTCOMES.IN_PROGRESS
      })
    })
  })

  describe('completion', () => {
    test('Should deterministically return the same result when completed twice with an identical result', async () => {
      const params = buildUniqueClaimParams()
      await claimIdempotency(db, params)

      const completeParams = {
        ...params,
        result: { catchRecordId: 'cr-1' },
        allowedResultFields: ['catchRecordId']
      }

      const firstCompletion = await completeIdempotencyClaim(db, completeParams)
      const storedAfterFirst = await db
        .collection(CATCH_IDEMPOTENCY_COLLECTION)
        .findOne({
          ownerUserId: params.ownerUserId,
          idempotencyKey: params.idempotencyKey
        })

      const secondCompletion = await completeIdempotencyClaim(
        db,
        completeParams
      )
      const storedAfterSecond = await db
        .collection(CATCH_IDEMPOTENCY_COLLECTION)
        .findOne({
          ownerUserId: params.ownerUserId,
          idempotencyKey: params.idempotencyKey
        })

      expect(firstCompletion).toEqual({ catchRecordId: 'cr-1' })
      expect(secondCompletion).toEqual({ catchRecordId: 'cr-1' })
      expect(storedAfterSecond.completedAt).toBe(storedAfterFirst.completedAt)
    })

    test('Should throw IDEMPOTENCY_CONFLICT and leave the stored result unchanged when completed again with a different result', async () => {
      const params = buildUniqueClaimParams()
      await claimIdempotency(db, params)
      await completeIdempotencyClaim(db, {
        ...params,
        result: { catchRecordId: 'cr-1' },
        allowedResultFields: ['catchRecordId']
      })

      await expect(
        completeIdempotencyClaim(db, {
          ...params,
          result: { catchRecordId: 'cr-2' },
          allowedResultFields: ['catchRecordId']
        })
      ).rejects.toMatchObject({
        category: 'IDEMPOTENCY_CONFLICT',
        code: 'IDEMPOTENCY_REQUEST_MISMATCH'
      })

      const storedDocument = await db
        .collection(CATCH_IDEMPOTENCY_COLLECTION)
        .findOne({
          ownerUserId: params.ownerUserId,
          idempotencyKey: params.idempotencyKey
        })
      expect(storedDocument.result).toEqual({ catchRecordId: 'cr-1' })
    })

    test('Should throw IDEMPOTENCY_CLAIM_NOT_FOUND when completing without a prior claim', async () => {
      const params = buildUniqueClaimParams()

      await expect(
        completeIdempotencyClaim(db, {
          ...params,
          result: { catchRecordId: 'cr-1' },
          allowedResultFields: ['catchRecordId']
        })
      ).rejects.toMatchObject({
        category: 'UNEXPECTED_INTERNAL_FAILURE',
        code: 'IDEMPOTENCY_CLAIM_NOT_FOUND'
      })
    })
  })
})
