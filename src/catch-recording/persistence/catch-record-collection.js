/**
 * The one Catch Record MongoDB collection owner.
 *
 * Collection names are source-level constants owned by the module that introduces them, not convict
 * configuration (`docs/configuration-decisions.md`). `'catch-records'` is taken directly from the
 * approved resource naming already used throughout
 * `design/plans/catch-recording-service-implementation-phases-plan.md`
 * (`POST /v1/catch-records`, `GET /v1/catch-records/{id}`, ...), matching the existing plugin's
 * kebab-case collection-naming convention (`'mongo-locks'`, `'example-data'` in
 * `src/plugins/mongodb.js`).
 */
export const CATCH_RECORD_COLLECTION = 'catch-records'

/**
 * Returns the Catch Record collection from the supplied database handle. The only place in the
 * repository that may resolve this collection name.
 *
 * @param {import('mongodb').Db} db
 * @returns {import('mongodb').Collection}
 */
export function getCatchRecordCollection(db) {
  return db.collection(CATCH_RECORD_COLLECTION)
}

/**
 * Creates the Catch Record indexes required by the approved Step 09 access patterns. Idempotent — safe
 * to call on every server start (mirrors the existing `createIndexes` pattern in
 * `src/plugins/mongodb.js`).
 *
 * Indexes:
 * - `_id` (MongoDB's automatic unique index) enforces the unique canonical internal ID and backs
 *   owner-scoped retrieval and the audit-metadata update primitive. Not created manually here — doing
 *   so would be redundant.
 * - `{ catchRecordReference: 1 }` unique — enforces the unique friendly reference and backs trusted
 *   internal reference retrieval.
 * - `{ ownerUserId: 1, createdAt: -1, _id: 1 }` — backs the owner-scoped bounded/deterministic list
 *   primitive (exact filter + sort + tie-breaker shape), avoiding an in-memory sort.
 *
 * No text, wildcard, TTL, history, idempotency, submission-operation, migration, or cache-related index
 * is created, and no index exists for a query shape Step 09 does not implement.
 *
 * @param {import('mongodb').Db} db
 */
export async function ensureCatchRecordIndexes(db) {
  const collection = getCatchRecordCollection(db)

  await collection.createIndex({ catchRecordReference: 1 }, { unique: true })
  await collection.createIndex({ ownerUserId: 1, createdAt: -1, _id: 1 })
}
