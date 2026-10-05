import {
  getCatchRecordCollection,
  ensureCatchRecordIndexes,
  CATCH_RECORD_COLLECTION
} from './catch-record-collection.js'
import {
  toPersistenceDocument,
  toCanonicalRecord
} from './catch-record-mapper.js'
import {
  assertPlainString,
  assertSafeListLimit,
  assertAllowedChanges
} from './persistence-guards.js'
import {
  translateInsertError,
  malformedDocumentError,
  unexpectedPersistenceError,
  versionConflictError
} from './catch-persistence-errors.js'
import {
  MIN_EXPECTED_VERSION,
  validateExpectedVersion
} from './expected-version.js'

/**
 * `CatchPersistence`: the sole Catch Recording owner of Catch Record MongoDB access.
 *
 * Every exported operation guards its scalar inputs with `persistence-guards.js` before building any
 * MongoDB filter or update document, maps explicitly via `catch-record-mapper.js`, and translates every
 * MongoDB failure via `catch-persistence-errors.js` — no raw MongoDB error, filter, update document, or
 * document content ever reaches a caller. See `docs/catch-recording-persistence.md` for the full
 * contract.
 *
 * Does not implement: routes, history, idempotency, authentication/authorisation, submission, section
 * updates, or any later-phase behaviour (Steps 10, 12, and beyond). Step 11 adds atomic optimistic
 * concurrency (expected-version matching and version increment) to the one existing-record mutation
 * primitive below; it does not add a second, competing update path.
 */

/** Persistence-owned technical safety ceiling for `listCatchRecordsByOwner` (see Step 09 plan §5). Not
 * a business page size — no approved default/page-size value exists yet (`docs/configuration-decisions.md`
 * defers final collection/payload limits). Callers must always supply an explicit `limit`. */
export const MAX_LIST_LIMIT = 100

/** The Catch Record audit-metadata fields `applyAuditMetadataUpdate` may `$set`. Nothing else — see the
 * Step 09 plan's "foundational atomic update primitive" decision. Step 11 extends this same primitive
 * with expected-version matching and a version increment rather than adding a competing update path. */
const AUDIT_METADATA_ALLOWED_FIELDS = Object.freeze(['updatedAt', 'updatedBy'])

function mapStoredDocument(document) {
  try {
    return toCanonicalRecord(document)
  } catch (cause) {
    throw malformedDocumentError(cause)
  }
}

/**
 * Inserts exactly one canonical Catch Record. Accepts a canonical record already created, normalised,
 * validated, and supplied by a later trusted application operation — never generates an ID, reference,
 * status, version, timestamp, or actor. Does not mutate `catchRecord`.
 *
 * @param {import('mongodb').Db} db
 * @param {import('../domain/canonical-catch-record.js').CatchRecord} catchRecord
 * @returns {Promise<import('../domain/canonical-catch-record.js').CatchRecord>} An independent copy of
 *   the created record.
 */
export async function createCatchRecord(db, catchRecord) {
  const collection = getCatchRecordCollection(db)
  const document = toPersistenceDocument(catchRecord)

  try {
    await collection.insertOne(document)
  } catch (error) {
    throw translateInsertError(error)
  }

  return mapStoredDocument(document)
}

/**
 * Owner-scoped retrieval by canonical internal ID. Ownership is part of the MongoDB filter itself —
 * never a post-query comparison. A different owner with the same `id`, or a wholly absent `id`, both
 * return `null` — no distinguishing behaviour, no disclosure.
 *
 * @param {import('mongodb').Db} db
 * @param {{ id: string, ownerUserId: string }} params
 * @returns {Promise<import('../domain/canonical-catch-record.js').CatchRecord|null>}
 */
export async function findCatchRecordByIdForOwner(db, { id, ownerUserId }) {
  assertPlainString(id, 'id')
  assertPlainString(ownerUserId, 'ownerUserId')

  const collection = getCatchRecordCollection(db)

  let document
  try {
    document = await collection.findOne({ _id: id, ownerUserId })
  } catch (error) {
    throw unexpectedPersistenceError(error)
  }

  return document ? mapStoredDocument(document) : null
}

/**
 * Trusted-internal, exact-match retrieval by friendly reference. Not owner-scoped — used only by a
 * future trusted application operation that needs to check reference existence/uniqueness (for example
 * Step 17's friendly-reference generation). Must never be exposed directly to an HTTP route without an
 * owner-scoping wrapper being added by a later approved contract.
 *
 * @param {import('mongodb').Db} db
 * @param {{ catchRecordReference: string }} params
 * @returns {Promise<import('../domain/canonical-catch-record.js').CatchRecord|null>}
 */
export async function findCatchRecordByReference(db, { catchRecordReference }) {
  assertPlainString(catchRecordReference, 'catchRecordReference')

  const collection = getCatchRecordCollection(db)

  let document
  try {
    document = await collection.findOne({ catchRecordReference })
  } catch (error) {
    throw unexpectedPersistenceError(error)
  }

  return document ? mapStoredDocument(document) : null
}

/**
 * The one existing-record atomic compare-and-update primitive `CatchPersistence` provides. Matches
 * canonical identity (`_id`), trusted owner identity (`ownerUserId`), and the caller's expected current
 * `version` in a single MongoDB predicate — the database predicate, not an application read, controls
 * the write. On a match, applies only the explicit allow-listed `$set` of `changes` (`updatedAt`/
 * `updatedBy`; any other key, including `version`, `status`, or any business field, throws a `TypeError`
 * before any MongoDB call is made) together with `$inc: { version: 1 }` in that same atomic call —
 * `version` increments by exactly `1` on success and is never settable by a caller directly.
 *
 * On no match, a single owner-scoped, version-less diagnostic read (`classifyMutationMiss`) — never part
 * of the write itself — distinguishes two safe outcomes: the record does not exist for this owner at all
 * (covers both a genuinely missing record and a cross-owner attempt; both return `null`, identically, so
 * a different owner can never learn the record exists), or the record exists for this owner but its
 * stored `version` no longer equals `expectedVersion` (a deterministic `VERSION_CONFLICT`
 * `ApplicationError`, thrown).
 *
 * Does not implement section-save behaviour, history, or any business field mapping — those are later
 * steps.
 *
 * @param {import('mongodb').Db} db
 * @param {{
 *   id: string,
 *   ownerUserId: string,
 *   expectedVersion: number,
 *   changes: { updatedAt?: string, updatedBy?: string }
 * }} params
 * @returns {Promise<import('../domain/canonical-catch-record.js').CatchRecord|null>} The updated
 *   canonical record (with `version` incremented by exactly `1`), or `null` when the record does not
 *   exist for this owner.
 * @throws {import('#/common/helpers/errors/application-error.js').ApplicationError} `VERSION_CONFLICT`
 *   when the record exists for this owner but `expectedVersion` no longer matches the stored version.
 */
export async function applyAuditMetadataUpdate(
  db,
  { id, ownerUserId, expectedVersion, changes }
) {
  assertPlainString(id, 'id')
  assertPlainString(ownerUserId, 'ownerUserId')
  const matchedVersion = validateExpectedVersion(expectedVersion)
  assertAllowedChanges(changes, AUDIT_METADATA_ALLOWED_FIELDS)

  const collection = getCatchRecordCollection(db)

  let document
  try {
    // One atomic compare-and-update: the predicate is the only concurrency control. This driver
    // version (`mongodb` ^7) resolves `findOneAndUpdate` directly to the updated document, or `null`
    // when no document matched (`includeResultMetadata` defaults to `false`).
    document = await collection.findOneAndUpdate(
      { _id: id, ownerUserId, version: matchedVersion },
      { $set: { ...changes }, $inc: { version: 1 } },
      { returnDocument: 'after' }
    )
  } catch (error) {
    throw unexpectedPersistenceError(error)
  }

  if (document) {
    return mapStoredDocument(document)
  }

  return classifyMutationMiss(collection, { id, ownerUserId })
}

/**
 * Classifies why the atomic compare-and-update above found no match. Runs only after the write has
 * already failed to match — this diagnostic read never gates, retries, or otherwise controls the write.
 * Owner-scoped and version-less by design, so a cross-owner attempt is indistinguishable from a
 * genuinely missing record (both resolve `null` here) — no existence is ever disclosed to the wrong
 * owner. A document found at this point for the correct owner can only mean its stored `version` no
 * longer equals the caller's `expectedVersion`.
 *
 * @param {import('mongodb').Collection} collection
 * @param {{ id: string, ownerUserId: string }} params
 * @returns {Promise<null>}
 * @throws {import('#/common/helpers/errors/application-error.js').ApplicationError} `VERSION_CONFLICT`
 */
async function classifyMutationMiss(collection, { id, ownerUserId }) {
  let existing
  try {
    existing = await collection.findOne(
      { _id: id, ownerUserId },
      { projection: { _id: 1 } }
    )
  } catch (error) {
    throw unexpectedPersistenceError(error)
  }

  if (existing === null) {
    return null
  }

  throw versionConflictError()
}

/**
 * Owner-scoped, bounded, deterministic list primitive. Filters by `ownerUserId` only (no status/vessel
 * filter, cursor, or offset — none is approved yet), sorted newest-first with a stable `_id`
 * tie-breaker, bounded by a caller-supplied `limit` which must not exceed `MAX_LIST_LIMIT`.
 *
 * @param {import('mongodb').Db} db
 * @param {{ ownerUserId: string, limit: number }} params
 * @returns {Promise<Array<import('../domain/canonical-catch-record.js').CatchRecord>>}
 */
export async function listCatchRecordsByOwner(db, { ownerUserId, limit }) {
  assertPlainString(ownerUserId, 'ownerUserId')
  assertSafeListLimit(limit, MAX_LIST_LIMIT)

  const collection = getCatchRecordCollection(db)

  let documents
  try {
    documents = await collection
      .find({ ownerUserId })
      .sort({ createdAt: -1, _id: 1 })
      .limit(limit)
      .toArray()
  } catch (error) {
    throw unexpectedPersistenceError(error)
  }

  return documents.map((document) => mapStoredDocument(document))
}

export { ensureCatchRecordIndexes, CATCH_RECORD_COLLECTION }
export { MIN_EXPECTED_VERSION, validateExpectedVersion }
