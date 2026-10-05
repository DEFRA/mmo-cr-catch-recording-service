import {
  getCatchIdempotencyCollection,
  ensureCatchIdempotencyIndexes,
  CATCH_IDEMPOTENCY_COLLECTION
} from './catch-idempotency-collection.js'
import {
  assertPlainString,
  assertAllowedChanges
} from './persistence-guards.js'
import {
  validateIdempotencyKey,
  assertBoundedPrintableToken
} from './idempotency-key.js'
import { validateOperationScope } from './idempotency-operation-scope.js'
import { assertFingerprint } from './idempotency-fingerprint.js'
import {
  isDuplicateIdempotencyClaimError,
  idempotencyConflictError,
  idempotencyClaimNotFoundError,
  malformedIdempotencyClaimDocumentError,
  unexpectedIdempotencyPersistenceError
} from './catch-idempotency-errors.js'

/**
 * `CatchPersistence`'s targeted-idempotency capability (Step 12) — the sole Catch Recording owner of
 * idempotency-claim MongoDB access.
 *
 * A new, separate mechanism from Step 11's optimistic concurrency: this module imports nothing from
 * `catch-persistence.js`, `catch-record-collection.js`, `catch-record-mapper.js`, or
 * `expected-version.js` (verified by `architecture-boundary.test.js`). It must never be used to bypass
 * `applyAuditMetadataUpdate`'s expected-version check — it answers "has this duplicate-consequence
 * operation already been claimed or completed for this scoped key and semantic request?", never "is this
 * mutation based on the current Catch Record version?".
 *
 * Public API is deliberately minimal: `claimIdempotency` (atomic first claim, with duplicate-key
 * classification into replay/in-progress/conflict) and `completeIdempotencyClaim` (atomic pending →
 * completed transition storing only minimal allow-listed replay facts). Neither updates the Catch
 * Record, appends history, or increments a Catch Record version.
 *
 * Does not implement: routes, business operations (draft creation, submission, completion, favourites,
 * skippers, edit start — Step 18 and beyond), a generic replay/workflow/retry framework, retention/TTL
 * behaviour (no retention period is approved — see `docs/configuration-decisions.md`), or any business
 * field-name catalogue (every `allowedFields`/`allowedResultFields` is supplied by the calling later
 * operation). See `docs/catch-recording-persistence.md` for the full contract.
 */

/** The two approved record states — no failure state, no retry counter, no lock-lease field. */
const CLAIM_STATES = Object.freeze({
  PENDING: 'PENDING',
  COMPLETED: 'COMPLETED'
})

/** The deterministic outcomes `claimIdempotency` can resolve to. */
export const IDEMPOTENCY_CLAIM_OUTCOMES = Object.freeze({
  CLAIMED: 'CLAIMED',
  REPLAY: 'REPLAY',
  IN_PROGRESS: 'IN_PROGRESS'
})

/** A private sentinel used when a caller omits `resourceId` (an operation with no existing resource,
 * such as first draft creation). Contains a NUL control character, so it can never collide with a
 * caller-supplied value — every caller-supplied `resourceId` is rejected by `assertBoundedPrintableToken`
 * if it contains any control character. Never exposed to a caller. */
const NO_RESOURCE_SCOPE = '\u0000NO_RESOURCE\u0000'

/** A generous technical ceiling for an explicit `resourceId`, matching `MAX_IDEMPOTENCY_KEY_LENGTH` —
 * resourceId is the same class of opaque, caller-supplied, injection-shaped-value risk as an idempotency
 * key. */
const MAX_RESOURCE_ID_LENGTH = 200

function trustedNowIso() {
  return new Date().toISOString()
}

function normaliseResourceId(resourceId) {
  if (resourceId === undefined || resourceId === null) {
    return NO_RESOURCE_SCOPE
  }

  return assertBoundedPrintableToken(
    resourceId,
    'resourceId',
    MAX_RESOURCE_ID_LENGTH
  )
}

function mapStoredResult(document) {
  if (
    document.result === null ||
    typeof document.result !== 'object' ||
    Array.isArray(document.result)
  ) {
    throw malformedIdempotencyClaimDocumentError(
      new TypeError('stored idempotency result must be a plain object')
    )
  }

  return Object.freeze({ ...document.result })
}

function sameStoredResult(storedResult, candidateResult) {
  const storedKeys = Object.keys(storedResult)
  const candidateKeys = Object.keys(candidateResult)

  if (storedKeys.length !== candidateKeys.length) {
    return false
  }

  return storedKeys.every((key) => storedResult[key] === candidateResult[key])
}

/**
 * Attempts to atomically claim a new idempotency scope, or classifies an existing one.
 *
 * MongoDB's unique composite index (`{ ownerUserId, operationScope, idempotencyKey, resourceId }`) is
 * the only uniqueness guard — never an application-level check-then-insert, never a lock, never polling.
 *
 * @param {import('mongodb').Db} db
 * @param {{
 *   ownerUserId: string,
 *   operationScope: string,
 *   idempotencyKey: string,
 *   resourceId?: string,
 *   fingerprint: string
 * }} params
 * @returns {Promise<Readonly<{ outcome: 'CLAIMED' }
 *   | { outcome: 'REPLAY', result: Readonly<object> }
 *   | { outcome: 'IN_PROGRESS' }>>}
 * @throws {import('#/common/helpers/errors/application-error.js').ApplicationError} `IDEMPOTENCY_CONFLICT`
 *   when the same scoped key is already claimed with a different fingerprint.
 */
export async function claimIdempotency(
  db,
  { ownerUserId, operationScope, idempotencyKey, resourceId, fingerprint }
) {
  assertPlainString(ownerUserId, 'ownerUserId')
  validateOperationScope(operationScope)
  validateIdempotencyKey(idempotencyKey)
  assertFingerprint(fingerprint)
  const scopedResourceId = normaliseResourceId(resourceId)

  const collection = getCatchIdempotencyCollection(db)

  const document = {
    ownerUserId,
    operationScope,
    idempotencyKey,
    resourceId: scopedResourceId,
    fingerprint,
    state: CLAIM_STATES.PENDING,
    createdAt: trustedNowIso()
  }

  try {
    await collection.insertOne(document)
    return Object.freeze({ outcome: IDEMPOTENCY_CLAIM_OUTCOMES.CLAIMED })
  } catch (error) {
    if (!isDuplicateIdempotencyClaimError(error)) {
      throw unexpectedIdempotencyPersistenceError(error)
    }
  }

  return classifyExistingClaim(collection, {
    ownerUserId,
    operationScope,
    idempotencyKey,
    resourceId: scopedResourceId,
    fingerprint
  })
}

async function classifyExistingClaim(
  collection,
  { ownerUserId, operationScope, idempotencyKey, resourceId, fingerprint }
) {
  let existing
  try {
    existing = await collection.findOne({
      ownerUserId,
      operationScope,
      idempotencyKey,
      resourceId
    })
  } catch (error) {
    throw unexpectedIdempotencyPersistenceError(error)
  }

  if (!existing) {
    throw unexpectedIdempotencyPersistenceError(
      new Error(
        'idempotency claim unexpectedly missing after a duplicate-key race'
      )
    )
  }

  if (existing.fingerprint !== fingerprint) {
    throw idempotencyConflictError()
  }

  if (existing.state === CLAIM_STATES.COMPLETED) {
    return Object.freeze({
      outcome: IDEMPOTENCY_CLAIM_OUTCOMES.REPLAY,
      result: mapStoredResult(existing)
    })
  }

  return Object.freeze({ outcome: IDEMPOTENCY_CLAIM_OUTCOMES.IN_PROGRESS })
}

/**
 * Atomically transitions an existing `PENDING` claim to `COMPLETED`, storing only the minimal
 * caller-supplied allow-listed replay facts. Scoped to the exact idempotency record — never a raw,
 * unscoped MongoDB update.
 *
 * @param {import('mongodb').Db} db
 * @param {{
 *   ownerUserId: string,
 *   operationScope: string,
 *   idempotencyKey: string,
 *   resourceId?: string,
 *   fingerprint: string,
 *   result: object,
 *   allowedResultFields: string[]
 * }} params
 * @returns {Promise<Readonly<object>>} An independent copy of the stored, allow-listed replay result.
 * @throws {import('#/common/helpers/errors/application-error.js').ApplicationError}
 *   `IDEMPOTENCY_CLAIM_NOT_FOUND` when no claim exists; `IDEMPOTENCY_CONFLICT` when the fingerprint
 *   differs, or the claim is already completed with a different result.
 */
export async function completeIdempotencyClaim(
  db,
  {
    ownerUserId,
    operationScope,
    idempotencyKey,
    resourceId,
    fingerprint,
    result,
    allowedResultFields
  }
) {
  assertPlainString(ownerUserId, 'ownerUserId')
  validateOperationScope(operationScope)
  validateIdempotencyKey(idempotencyKey)
  assertFingerprint(fingerprint)
  const scopedResourceId = normaliseResourceId(resourceId)
  assertAllowedChanges(result, allowedResultFields)

  const collection = getCatchIdempotencyCollection(db)
  const completedResult = { ...result }

  let document
  try {
    document = await collection.findOneAndUpdate(
      {
        ownerUserId,
        operationScope,
        idempotencyKey,
        resourceId: scopedResourceId,
        fingerprint,
        state: CLAIM_STATES.PENDING
      },
      {
        $set: {
          state: CLAIM_STATES.COMPLETED,
          completedAt: trustedNowIso(),
          result: completedResult
        }
      },
      { returnDocument: 'after' }
    )
  } catch (error) {
    throw unexpectedIdempotencyPersistenceError(error)
  }

  if (document) {
    return mapStoredResult(document)
  }

  return classifyCompletionMiss(collection, {
    ownerUserId,
    operationScope,
    idempotencyKey,
    resourceId: scopedResourceId,
    fingerprint,
    candidateResult: completedResult
  })
}

async function classifyCompletionMiss(
  collection,
  {
    ownerUserId,
    operationScope,
    idempotencyKey,
    resourceId,
    fingerprint,
    candidateResult
  }
) {
  let existing
  try {
    existing = await collection.findOne({
      ownerUserId,
      operationScope,
      idempotencyKey,
      resourceId
    })
  } catch (error) {
    throw unexpectedIdempotencyPersistenceError(error)
  }

  if (!existing) {
    throw idempotencyClaimNotFoundError()
  }

  if (existing.fingerprint !== fingerprint) {
    throw idempotencyConflictError()
  }

  if (existing.state === CLAIM_STATES.COMPLETED) {
    const storedResult = mapStoredResult(existing)

    if (sameStoredResult(storedResult, candidateResult)) {
      return storedResult
    }

    throw idempotencyConflictError()
  }

  throw unexpectedIdempotencyPersistenceError(
    new Error('idempotency claim completion predicate unexpectedly unmatched')
  )
}

export { ensureCatchIdempotencyIndexes, CATCH_IDEMPOTENCY_COLLECTION }
