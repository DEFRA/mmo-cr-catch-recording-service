import {
  deleteEligibleDraftForOwner,
  validateExpectedVersion
} from '#/catch-recording/persistence/catch-persistence.js'
import {
  appendCatchHistoryEvent,
  CATCH_HISTORY_EVENT_TYPES
} from '#/catch-recording/persistence/catch-history-persistence.js'

/**
 * Step 19: eligible never-submitted draft abandonment (`DELETE /v1/catch-records/{catchRecordId}`).
 *
 * Resource authorisation is embedded in `deleteEligibleDraftForOwner`'s own owner-scoped MongoDB
 * predicate (mirrors the established `findCatchRecordByIdForOwner`/`applyAuditMetadataUpdate` pattern
 * elsewhere in this module) rather than a separate read-then-compare policy call — a cross-owner
 * attempt and a genuinely missing record are deliberately indistinguishable outcomes (both resolve to
 * the same safe, idempotent "nothing happened" result), never disclosing existence to the wrong caller.
 *
 * Deterministically idempotent: whether this call physically deleted the record or the record was
 * already gone (already abandoned, or never existed for this owner), the caller receives the same safe
 * success outcome. History is appended only when a deletion actually occurred.
 *
 * @param {Object} input
 * @param {import('mongodb').Db} input.db
 * @param {{ userId: string, scopes: ReadonlyArray<string> }} input.authenticationContext
 * @param {string} input.catchRecordId
 * @param {number} input.expectedVersion
 * @returns {Promise<void>}
 * @throws {import('#/common/helpers/errors/application-error.js').ApplicationError}
 *   `INVALID_LIFECYCLE_TRANSITION` or `VERSION_CONFLICT` when the record exists but is ineligible.
 */
export async function abandonDraftCatchRecord({
  db,
  authenticationContext,
  catchRecordId,
  expectedVersion
}) {
  const ownerUserId = authenticationContext?.userId
  const matchedVersion = validateExpectedVersion(expectedVersion)

  const deleted = await deleteEligibleDraftForOwner(db, {
    id: catchRecordId,
    ownerUserId,
    expectedVersion: matchedVersion
  })

  if (deleted) {
    await appendCatchHistoryEvent(db, {
      catchRecordId: deleted.id,
      ownerUserId,
      eventType: CATCH_HISTORY_EVENT_TYPES.DRAFT_ABANDONED,
      timestamp: new Date().toISOString(),
      actorUserId: ownerUserId
    })
  }
}
