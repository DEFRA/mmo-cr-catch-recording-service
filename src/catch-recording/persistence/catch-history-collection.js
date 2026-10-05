/**
 * The one Catch Record history MongoDB collection owner.
 *
 * A separate collection (not an embedded field on the Catch Record document) — see the Step 10 saved
 * plan's "Storage decision" for the approved-document evidence. Collection names are source-level
 * constants owned by the module that introduces them, not convict configuration
 * (`docs/configuration-decisions.md`), mirroring the existing `catch-records` collection.
 */
export const CATCH_HISTORY_COLLECTION = 'catch-record-history'

/**
 * Returns the Catch Record history collection from the supplied database handle. The only place in the
 * repository that may resolve this collection name.
 *
 * @param {import('mongodb').Db} db
 * @returns {import('mongodb').Collection}
 */
export function getCatchHistoryCollection(db) {
  return db.collection(CATCH_HISTORY_COLLECTION)
}

/**
 * Creates the one index required by the approved Step 10 access pattern. Idempotent — safe to call on
 * every server start (mirrors `ensureCatchRecordIndexes` in `catch-record-collection.js`).
 *
 * Index: `{ catchRecordId: 1, ownerUserId: 1, timestamp: 1, _id: 1 }` — backs
 * `listCatchHistoryEventsForOwner`'s exact filter (`catchRecordId` + `ownerUserId` equality) followed by
 * its deterministic sort (`timestamp` then `_id` tie-breaker). No other query exists against this
 * collection, so no other index is created — no text, wildcard, TTL, or administrative-browsing index.
 *
 * @param {import('mongodb').Db} db
 */
export async function ensureCatchHistoryIndexes(db) {
  const collection = getCatchHistoryCollection(db)

  await collection.createIndex({
    catchRecordId: 1,
    ownerUserId: 1,
    timestamp: 1,
    _id: 1
  })
}
