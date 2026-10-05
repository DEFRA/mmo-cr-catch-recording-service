/**
 * The one Catch Recording idempotency-claim MongoDB collection owner.
 *
 * A separate collection from both `catch-records` and `catch-record-history` — idempotency claims are
 * neither the operational Catch Record nor a history event (Step 12 plan, decision 1 and 5). Collection
 * names are source-level constants owned by the module that introduces them, not convict configuration
 * (`docs/configuration-decisions.md`), mirroring `catch-record-collection.js`/`catch-history-collection.js`.
 */
export const CATCH_IDEMPOTENCY_COLLECTION = 'catch-idempotency-claims'

/**
 * Returns the idempotency-claim collection from the supplied database handle. The only place in the
 * repository that may resolve this collection name.
 *
 * @param {import('mongodb').Db} db
 * @returns {import('mongodb').Collection}
 */
export function getCatchIdempotencyCollection(db) {
  return db.collection(CATCH_IDEMPOTENCY_COLLECTION)
}

/**
 * Creates the one index required by the approved Step 12 access pattern. Idempotent — safe to call on
 * every server start (mirrors `ensureCatchRecordIndexes`/`ensureCatchHistoryIndexes`).
 *
 * Index: `{ ownerUserId: 1, operationScope: 1, idempotencyKey: 1, resourceId: 1 }` unique — the single
 * composite scope that guarantees atomic first-claim uniqueness and backs every lookup this module
 * performs (the classification read after a duplicate-key race, and the completion predicate, are both
 * exact-prefix matches against this same index). No TTL index exists — Step 12 plan decision 11 records
 * that no idempotency-record retention period is approved anywhere
 * (`docs/configuration-decisions.md`); adding a TTL/expiry value here would invent an unapproved business
 * decision. No text, wildcard, or administrative-browsing index.
 *
 * @param {import('mongodb').Db} db
 */
export async function ensureCatchIdempotencyIndexes(db) {
  const collection = getCatchIdempotencyCollection(db)

  await collection.createIndex(
    { ownerUserId: 1, operationScope: 1, idempotencyKey: 1, resourceId: 1 },
    { unique: true }
  )
}
