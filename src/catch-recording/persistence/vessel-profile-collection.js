/**
 * The one Catch Recording vessel-profile MongoDB collection owner.
 *
 * A separate collection from `catch-records`, `catch-record-history`, and `catch-idempotency-claims` —
 * vessel-scoped convenience data (favourite gears/species/ports and vessel-owned skippers) is neither an
 * operational Catch Record, a history event, nor an idempotency claim
 * (`design/plans/catch-recording-service-detailed-implementation-plan.md` §8.1). Collection names are
 * source-level constants owned by the module that introduces them, not convict configuration
 * (`docs/configuration-decisions.md`), mirroring `catch-record-collection.js`/`catch-history-collection.js`/
 * `catch-idempotency-collection.js`.
 */
export const VESSEL_PROFILE_COLLECTION = 'vessel-profiles'

/**
 * Returns the vessel-profile collection from the supplied database handle. The only place in the
 * repository that may resolve this collection name.
 *
 * @param {import('mongodb').Db} db
 * @returns {import('mongodb').Collection}
 */
export function getVesselProfileCollection(db) {
  return db.collection(VESSEL_PROFILE_COLLECTION)
}

/**
 * A vessel profile is keyed by the authoritative vessel ID itself (stored as `_id`) — there is exactly
 * one profile document per vessel, so MongoDB's automatic unique `_id` index is the only index this
 * access pattern needs. No separate `{ vesselId: 1 }` index, no skipper-name index (skipper duplicate
 * detection is enforced atomically per-document by `vessel-profile-persistence.js`'s update filter, not
 * by a secondary collection-level index), no TTL index (the approved retention decision — see
 * `docs/configuration-decisions.md` "Phase 9 decisions" — is "retained indefinitely, including when
 * empty"; no expiry is approved anywhere).
 *
 * @param {import('mongodb').Db} _db
 */
export async function ensureVesselProfileIndexes(_db) {
  // Intentionally a no-op beyond MongoDB's automatic `_id` index — kept as an explicit function so
  // `src/plugins/mongodb.js` can call it unconditionally, mirroring every other collection's
  // `ensure*Indexes` composition, and so a later approved index requirement has one obvious place to
  // land without changing the plugin's composition again.
}
