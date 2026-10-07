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
  assertAllowedChanges,
  assertSectionChanges,
  assertCompleteReplacementChanges
} from './persistence-guards.js'
import {
  translateInsertError,
  malformedDocumentError,
  unexpectedPersistenceError,
  versionConflictError,
  ineligibleAbandonmentError,
  ineligibleReplacementError,
  ineligibleSectionUpdateError,
  ineligibleSubmissionError,
  ineligibleCompletionError,
  ineligibleEditStartError
} from './catch-persistence-errors.js'
import {
  MIN_EXPECTED_VERSION,
  validateExpectedVersion
} from './expected-version.js'
import {
  PERSISTED_STATUSES,
  isPersistedStatus
} from '../domain/lifecycle-status.js'

/**
 * `CatchPersistence`: the sole Catch Recording owner of Catch Record MongoDB access.
 *
 * Every exported operation guards its scalar inputs with `persistence-guards.js` before building any
 * MongoDB filter or update document, maps explicitly via `catch-record-mapper.js`, and translates every
 * MongoDB failure via `catch-persistence-errors.js` — no raw MongoDB error, filter, update document, or
 * document content ever reaches a caller. See `docs/catch-recording-persistence.md` for the full
 * contract.
 *
 * Does not implement: routes, history, idempotency, authentication/authorisation, submission, or any
 * later-phase behaviour beyond Step 19. Step 11 adds atomic optimistic concurrency (expected-version
 * matching and version increment) to the audit-metadata mutation primitive; it does not add a second,
 * competing update path. Step 19 adds one further atomic primitive, `deleteEligibleDraftForOwner` — a
 * physical delete (the Catch Record's own append-only history lives in a separate collection and is
 * unaffected), not a status change — because the canonical contract has no "abandoned"/"inactive" field
 * to set instead (`PERSISTED_STATUSES` remains exactly `DRAFT`/`SUBMITTED`/`COMPLETE`).
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
 * Trusted-internal, exact-match retrieval by canonical internal ID alone — **not** owner-scoped.
 * Reserved exclusively for Step 36's restricted completion, the one approved operation whose
 * authorisation is purely permission-gated rather than ownership-gated (`completion-policy.js`'s
 * `decideCompletionAccess` has no `ownerUserId` parameter by design). Must never be exposed directly to
 * an HTTP route or used by any ownership-scoped operation.
 *
 * @param {import('mongodb').Db} db
 * @param {{ id: string }} params
 * @returns {Promise<import('../domain/canonical-catch-record.js').CatchRecord|null>}
 */
export async function findCatchRecordById(db, { id }) {
  assertPlainString(id, 'id')

  const collection = getCatchRecordCollection(db)

  let document
  try {
    document = await collection.findOne({ _id: id })
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
 * Step 20's one atomic generic section-update primitive, extended by Step 38 with a `status: DRAFT`
 * predicate condition - mirroring `applyCompleteReplacement`'s established "lifecycle eligibility
 * embedded in the same atomic predicate, not an application read" pattern. A section save (first-draft
 * or amendment) is only ever valid against a `DRAFT` record (never-submitted or amended); a
 * `SUBMITTED`/`COMPLETE` record must first return to `DRAFT` via Step 37's edit-start. The only
 * difference from `applyAuditMetadataUpdate`'s shape is `changes` may additionally carry exactly one
 * allow-listed section field whose own value is a plain object, guarded by `assertSectionChanges`
 * instead of `assertAllowedChanges`.
 *
 * `allowedFields` is always supplied by the calling later business operation (mirrors Step 12's
 * `allowedFields` pattern) - this module hard-codes no section-name catalogue itself, so a future phase
 * extending the approved section allow-list never requires a change here.
 *
 * @param {import('mongodb').Db} db
 * @param {{
 *   id: string,
 *   ownerUserId: string,
 *   expectedVersion: number,
 *   changes: { updatedAt: string, updatedBy: string, [section: string]: unknown },
 *   allowedFields: ReadonlyArray<string>
 * }} params
 * @returns {Promise<import('../domain/canonical-catch-record.js').CatchRecord|null>} The updated
 *   canonical record (with `version` incremented by exactly `1`), or `null` when the record does not
 *   exist for this owner.
 * @throws {import('#/common/helpers/errors/application-error.js').ApplicationError}
 *   `INVALID_LIFECYCLE_TRANSITION` or `VERSION_CONFLICT`.
 */
export async function applySectionUpdate(
  db,
  { id, ownerUserId, expectedVersion, changes, allowedFields }
) {
  assertPlainString(id, 'id')
  assertPlainString(ownerUserId, 'ownerUserId')
  const matchedVersion = validateExpectedVersion(expectedVersion)
  assertSectionChanges(changes, allowedFields)

  const collection = getCatchRecordCollection(db)

  let document
  try {
    document = await collection.findOneAndUpdate(
      {
        _id: id,
        ownerUserId,
        status: PERSISTED_STATUSES.DRAFT,
        version: matchedVersion
      },
      { $set: { ...changes }, $inc: { version: 1 } },
      { returnDocument: 'after' }
    )
  } catch (error) {
    throw unexpectedPersistenceError(error)
  }

  if (document) {
    return mapStoredDocument(document)
  }

  return classifySectionUpdateMiss(collection, { id, ownerUserId })
}

/**
 * Classifies why the atomic section-update above found no match. Runs only after the write has already
 * failed to match - this diagnostic read never gates, retries, or otherwise controls the write.
 *
 * @param {import('mongodb').Collection} collection
 * @param {{ id: string, ownerUserId: string }} params
 * @returns {Promise<null>}
 * @throws {import('#/common/helpers/errors/application-error.js').ApplicationError}
 */
async function classifySectionUpdateMiss(collection, { id, ownerUserId }) {
  let existing
  try {
    existing = await collection.findOne({ _id: id, ownerUserId })
  } catch (error) {
    throw unexpectedPersistenceError(error)
  }

  if (existing === null) {
    return null
  }

  if (existing.status !== PERSISTED_STATUSES.DRAFT) {
    throw ineligibleSectionUpdateError()
  }

  throw versionConflictError()
}

/**
 * Rejects an optional persisted-status filter value unless it is one of the three approved persisted
 * lifecycle statuses (Step 28: "persisted lifecycle filtering is limited to DRAFT, SUBMITTED, and
 * COMPLETE" — the derived `Amended` display status is never a query-time filter value here).
 *
 * @param {unknown} value
 */
function assertOptionalPersistedStatusFilter(value) {
  if (value !== undefined && !isPersistedStatus(value)) {
    throw new TypeError(
      `"status" must be one of ${Object.values(PERSISTED_STATUSES).join(', ')}`
    )
  }
}

/**
 * Owner-scoped, bounded, deterministic list primitive. Filters by `ownerUserId` (mandatory) and an
 * optional approved persisted `status` — no vessel filter, cursor, or offset, none of which is approved
 * (Step 28 decision). Sorted newest-first with a stable `_id` tie-breaker, bounded by a caller-supplied
 * `limit` which must not exceed `MAX_LIST_LIMIT`.
 *
 * @param {import('mongodb').Db} db
 * @param {{ ownerUserId: string, limit: number, status?: string }} params
 * @returns {Promise<Array<import('../domain/canonical-catch-record.js').CatchRecord>>}
 */
export async function listCatchRecordsByOwner(
  db,
  { ownerUserId, limit, status }
) {
  assertPlainString(ownerUserId, 'ownerUserId')
  assertSafeListLimit(limit, MAX_LIST_LIMIT)
  assertOptionalPersistedStatusFilter(status)

  const collection = getCatchRecordCollection(db)
  const filter = status ? { ownerUserId, status } : { ownerUserId }

  let documents
  try {
    documents = await collection
      .find(filter)
      .sort({ createdAt: -1, _id: 1 })
      .limit(limit)
      .toArray()
  } catch (error) {
    throw unexpectedPersistenceError(error)
  }

  return documents.map((document) => mapStoredDocument(document))
}

/**
 * Step 19's one atomic eligible-draft-abandonment primitive. Physically deletes the Catch Record
 * document — the Catch Record's append-only history (a separate collection, never embedded) is
 * unaffected and remains a true audit trail of the abandonment.
 *
 * The predicate embeds the full eligibility check atomically (owner, never-submitted `DRAFT`, and the
 * caller's expected version) in one call — mirrors `applyAuditMetadataUpdate`'s "predicate, not an
 * application read, controls the write" pattern, extended to a delete.
 *
 * On no match, a single owner-scoped, version-less diagnostic read distinguishes three safe, idempotent
 * outcomes, never disclosing more to the wrong owner than an identical "nothing happened" result:
 * - The record does not exist for this owner at all (covers a genuinely missing record, a cross-owner
 *   attempt, and an already-abandoned record — all indistinguishable, all return `null`). Deliberately
 *   idempotent: a repeated `DELETE` on an already-abandoned draft is treated the same as the first
 *   successful call, never as an error.
 * - The record exists for this owner but is not an eligible never-submitted `DRAFT` (already submitted,
 *   completed, or an amended draft) — throws `INVALID_LIFECYCLE_TRANSITION`.
 * - The record exists for this owner, is an eligible `DRAFT`, but its stored `version` no longer matches
 *   `expectedVersion` — throws `VERSION_CONFLICT`.
 *
 * @param {import('mongodb').Db} db
 * @param {{ id: string, ownerUserId: string, expectedVersion: number }} params
 * @returns {Promise<import('../domain/canonical-catch-record.js').CatchRecord|null>} The now-deleted
 *   canonical record (so a caller can append a safe history event referencing it), or `null` when
 *   nothing matched (already abandoned, never existed, or a cross-owner attempt).
 * @throws {import('#/common/helpers/errors/application-error.js').ApplicationError}
 *   `INVALID_LIFECYCLE_TRANSITION` or `VERSION_CONFLICT`.
 */
export async function deleteEligibleDraftForOwner(
  db,
  { id, ownerUserId, expectedVersion }
) {
  assertPlainString(id, 'id')
  assertPlainString(ownerUserId, 'ownerUserId')
  const matchedVersion = validateExpectedVersion(expectedVersion)

  const collection = getCatchRecordCollection(db)

  let document
  try {
    document = await collection.findOneAndDelete({
      _id: id,
      ownerUserId,
      status: PERSISTED_STATUSES.DRAFT,
      numberOfSubmissions: 0,
      submittedAt: null,
      submittedBy: null,
      version: matchedVersion
    })
  } catch (error) {
    throw unexpectedPersistenceError(error)
  }

  if (document) {
    return mapStoredDocument(document)
  }

  return classifyAbandonmentMiss(collection, { id, ownerUserId })
}

/**
 * Classifies why the atomic eligible-draft delete above found no match. Runs only after the delete has
 * already failed to match — this diagnostic read never gates, retries, or otherwise controls the write.
 *
 * @param {import('mongodb').Collection} collection
 * @param {{ id: string, ownerUserId: string }} params
 * @returns {Promise<null>}
 * @throws {import('#/common/helpers/errors/application-error.js').ApplicationError}
 */
async function classifyAbandonmentMiss(collection, { id, ownerUserId }) {
  let existing
  try {
    existing = await collection.findOne({ _id: id, ownerUserId })
  } catch (error) {
    throw unexpectedPersistenceError(error)
  }

  if (existing === null) {
    return null
  }

  const isEligibleDraft =
    existing.status === PERSISTED_STATUSES.DRAFT &&
    existing.numberOfSubmissions === 0 &&
    existing.submittedAt == null &&
    existing.submittedBy == null

  if (!isEligibleDraft) {
    throw ineligibleAbandonmentError()
  }

  throw versionConflictError()
}

/** The Step 30 approved complete-replacement client-owned section fields — every one is always present
 * on a successful call (a complete replacement, never a partial one). */
const COMPLETE_REPLACEMENT_ALLOWED_FIELDS = Object.freeze([
  'vessel',
  'trip',
  'pairFishing',
  'gears',
  'speciesNotLanded'
])

/**
 * Step 30's one atomic complete-replacement primitive. Extends `applyAuditMetadataUpdate`/
 * `applySectionUpdate`'s exact atomic predicate/update shape with one further condition: the predicate
 * also embeds `status: DRAFT` — lifecycle eligibility is enforced atomically, in the same database call
 * as the expected-version match, exactly mirroring `deleteEligibleDraftForOwner`'s "predicate, not an
 * application read, controls the write" pattern applied to a lifecycle precondition. On success, every
 * approved client-owned section (`vessel`, `trip`, `pairFishing`, `gears`, `speciesNotLanded`) is
 * `$set` together with trusted `updatedAt`/`updatedBy`, and `version` increments by exactly `1`.
 *
 * On no match, a single owner-scoped, version-less diagnostic read distinguishes three safe outcomes,
 * mirroring `classifyAbandonmentMiss`: the record does not exist for this owner at all (covers a
 * genuinely missing record and a cross-owner attempt - both return `null`); the record exists for this
 * owner but is not `DRAFT` (`SUBMITTED`/`COMPLETE` - throws `INVALID_LIFECYCLE_TRANSITION`); or the
 * record exists for this owner and is `DRAFT`, but its stored `version` no longer matches
 * `expectedVersion` (throws `VERSION_CONFLICT`).
 *
 * @param {import('mongodb').Db} db
 * @param {{
 *   id: string,
 *   ownerUserId: string,
 *   expectedVersion: number,
 *   changes: { updatedAt: string, updatedBy: string, vessel: object, trip: object,
 *     pairFishing: object, gears: Array<object>, speciesNotLanded: Array<object> }
 * }} params
 * @returns {Promise<import('../domain/canonical-catch-record.js').CatchRecord|null>} The updated
 *   canonical record (with `version` incremented by exactly `1`), or `null` when the record does not
 *   exist for this owner.
 * @throws {import('#/common/helpers/errors/application-error.js').ApplicationError}
 *   `INVALID_LIFECYCLE_TRANSITION` or `VERSION_CONFLICT`.
 */
export async function applyCompleteReplacement(
  db,
  { id, ownerUserId, expectedVersion, changes }
) {
  assertPlainString(id, 'id')
  assertPlainString(ownerUserId, 'ownerUserId')
  const matchedVersion = validateExpectedVersion(expectedVersion)
  assertCompleteReplacementChanges(changes, COMPLETE_REPLACEMENT_ALLOWED_FIELDS)

  const collection = getCatchRecordCollection(db)

  let document
  try {
    document = await collection.findOneAndUpdate(
      {
        _id: id,
        ownerUserId,
        status: PERSISTED_STATUSES.DRAFT,
        version: matchedVersion
      },
      { $set: { ...changes }, $inc: { version: 1 } },
      { returnDocument: 'after' }
    )
  } catch (error) {
    throw unexpectedPersistenceError(error)
  }

  if (document) {
    return mapStoredDocument(document)
  }

  return classifyReplacementMiss(collection, { id, ownerUserId })
}

/**
 * Classifies why the atomic complete-replacement update above found no match. Runs only after the write
 * has already failed to match — this diagnostic read never gates, retries, or otherwise controls the
 * write.
 *
 * @param {import('mongodb').Collection} collection
 * @param {{ id: string, ownerUserId: string }} params
 * @returns {Promise<null>}
 * @throws {import('#/common/helpers/errors/application-error.js').ApplicationError}
 */
async function classifyReplacementMiss(collection, { id, ownerUserId }) {
  let existing
  try {
    existing = await collection.findOne({ _id: id, ownerUserId })
  } catch (error) {
    throw unexpectedPersistenceError(error)
  }

  if (existing === null) {
    return null
  }

  if (existing.status !== PERSISTED_STATUSES.DRAFT) {
    throw ineligibleReplacementError()
  }

  throw versionConflictError()
}

/**
 * Rejects an `artifacts` value unless it is an array of plain objects, each carrying at least the
 * approved `{ submissionNumber, type }` identity fields - the one shape `CatchArtifact`/`PDFGenerator`
 * (Step 33) ever produces. Never inspects deeper than this identity (content type/length/checksum are
 * additional safe fields a caller may include, never required by this guard).
 *
 * @param {unknown} artifacts
 */
function assertArtifactsArray(artifacts) {
  if (!Array.isArray(artifacts)) {
    throw new TypeError('"artifacts" must be an array')
  }

  for (const artifact of artifacts) {
    if (
      artifact === null ||
      typeof artifact !== 'object' ||
      Array.isArray(artifact) ||
      !Number.isInteger(artifact.submissionNumber) ||
      typeof artifact.type !== 'string' ||
      artifact.type.length === 0
    ) {
      throw new TypeError(
        '"artifacts" entries must each carry an integer "submissionNumber" and a non-empty "type"'
      )
    }
  }
}

function assertSafeSubmissionNumber(submissionNumber) {
  if (!Number.isInteger(submissionNumber) || submissionNumber <= 0) {
    throw new TypeError('"submissionNumber" must be a positive integer')
  }
}

/**
 * Step 34/38's one atomic submission-commitment primitive, reused identically by first submission and
 * resubmission (the persisted source status is `DRAFT` in both cases - a never-submitted draft for the
 * former, an amended draft for the latter; eligibility between the two is decided by the caller before
 * this primitive is ever called). Extends the exact same atomic predicate/update shape as
 * `applyCompleteReplacement` (status embedded in the predicate alongside id/owner/version), so a
 * concurrent lifecycle change or a stale version both fail the single atomic call rather than racing an
 * application-level check.
 *
 * On success: `status` becomes `SUBMITTED`, `numberOfSubmissions` becomes the caller-supplied
 * deterministic `submissionNumber`, `hasUnsubmittedChanges` is cleared, the complete `artifacts` array
 * (prior entries preserved, new entries appended by the caller before calling this primitive) is set,
 * submission metadata is recorded, and `version` increments by exactly `1`.
 *
 * @param {import('mongodb').Db} db
 * @param {{
 *   id: string,
 *   ownerUserId: string,
 *   expectedVersion: number,
 *   submissionNumber: number,
 *   artifacts: ReadonlyArray<{ submissionNumber: number, type: string }>,
 *   submittedAt: string,
 *   submittedBy: string,
 *   updatedAt: string,
 *   updatedBy: string
 * }} params
 * @returns {Promise<import('../domain/canonical-catch-record.js').CatchRecord|null>} The updated
 *   canonical record, or `null` when the record does not exist for this owner.
 * @throws {import('#/common/helpers/errors/application-error.js').ApplicationError}
 *   `INVALID_LIFECYCLE_TRANSITION` or `VERSION_CONFLICT`.
 */
export async function applySubmission(
  db,
  {
    id,
    ownerUserId,
    expectedVersion,
    submissionNumber,
    artifacts,
    submittedAt,
    submittedBy,
    updatedAt,
    updatedBy
  }
) {
  assertPlainString(id, 'id')
  assertPlainString(ownerUserId, 'ownerUserId')
  const matchedVersion = validateExpectedVersion(expectedVersion)
  assertSafeSubmissionNumber(submissionNumber)
  assertArtifactsArray(artifacts)
  assertPlainString(submittedAt, 'submittedAt')
  assertPlainString(submittedBy, 'submittedBy')
  assertPlainString(updatedAt, 'updatedAt')
  assertPlainString(updatedBy, 'updatedBy')

  const collection = getCatchRecordCollection(db)

  let document
  try {
    document = await collection.findOneAndUpdate(
      {
        _id: id,
        ownerUserId,
        status: PERSISTED_STATUSES.DRAFT,
        version: matchedVersion
      },
      {
        $set: {
          status: PERSISTED_STATUSES.SUBMITTED,
          numberOfSubmissions: submissionNumber,
          hasUnsubmittedChanges: false,
          artifacts,
          submittedAt,
          submittedBy,
          updatedAt,
          updatedBy
        },
        $inc: { version: 1 }
      },
      { returnDocument: 'after' }
    )
  } catch (error) {
    throw unexpectedPersistenceError(error)
  }

  if (document) {
    return mapStoredDocument(document)
  }

  return classifySubmissionMiss(collection, { id, ownerUserId })
}

/**
 * Classifies why the atomic submission-commitment update above found no match. Runs only after the
 * write has already failed to match - this diagnostic read never gates, retries, or otherwise controls
 * the write.
 *
 * @param {import('mongodb').Collection} collection
 * @param {{ id: string, ownerUserId: string }} params
 * @returns {Promise<null>}
 * @throws {import('#/common/helpers/errors/application-error.js').ApplicationError}
 */
async function classifySubmissionMiss(collection, { id, ownerUserId }) {
  let existing
  try {
    existing = await collection.findOne({ _id: id, ownerUserId })
  } catch (error) {
    throw unexpectedPersistenceError(error)
  }

  if (existing === null) {
    return null
  }

  if (existing.status !== PERSISTED_STATUSES.DRAFT) {
    throw ineligibleSubmissionError()
  }

  throw versionConflictError()
}

/**
 * Step 36's one atomic restricted-completion primitive. Deliberately **not** owner-scoped - the
 * predicate matches only canonical identity (`_id`), persisted status (`SUBMITTED`), and the caller's
 * expected version, exactly mirroring every other atomic primitive's "predicate, not an application
 * read, controls the write" guarantee, applied to a permission-gated (not ownership-gated) operation.
 * `completion-policy.js`'s `decideCompletionAccess` must already have authorised the caller before this
 * is ever invoked - this primitive enforces only the lifecycle and concurrency preconditions.
 *
 * On success: `status` becomes `COMPLETE`, trusted completion metadata is recorded, and `version`
 * increments by exactly `1`. Submission count and artifacts are untouched (not part of this `$set`).
 *
 * @param {import('mongodb').Db} db
 * @param {{ id: string, expectedVersion: number, completedAt: string, completedBy: string }} params
 * @returns {Promise<import('../domain/canonical-catch-record.js').CatchRecord|null>} The updated
 *   canonical record, or `null` when no record exists with this id.
 * @throws {import('#/common/helpers/errors/application-error.js').ApplicationError}
 *   `INVALID_LIFECYCLE_TRANSITION` or `VERSION_CONFLICT`.
 */
export async function applyCompletion(
  db,
  { id, expectedVersion, completedAt, completedBy }
) {
  assertPlainString(id, 'id')
  const matchedVersion = validateExpectedVersion(expectedVersion)
  assertPlainString(completedAt, 'completedAt')
  assertPlainString(completedBy, 'completedBy')

  const collection = getCatchRecordCollection(db)

  let document
  try {
    document = await collection.findOneAndUpdate(
      {
        _id: id,
        status: PERSISTED_STATUSES.SUBMITTED,
        version: matchedVersion
      },
      {
        $set: {
          status: PERSISTED_STATUSES.COMPLETE,
          completedAt,
          completedBy,
          updatedAt: completedAt,
          updatedBy: completedBy
        },
        $inc: { version: 1 }
      },
      { returnDocument: 'after' }
    )
  } catch (error) {
    throw unexpectedPersistenceError(error)
  }

  if (document) {
    return mapStoredDocument(document)
  }

  return classifyCompletionMiss(collection, { id })
}

/**
 * Classifies why the atomic completion update above found no match. Runs only after the write has
 * already failed to match - this diagnostic read never gates, retries, or otherwise controls the write.
 * Not owner-scoped, matching `applyCompletion`'s own predicate.
 *
 * @param {import('mongodb').Collection} collection
 * @param {{ id: string }} params
 * @returns {Promise<null>}
 * @throws {import('#/common/helpers/errors/application-error.js').ApplicationError}
 */
async function classifyCompletionMiss(collection, { id }) {
  let existing
  try {
    existing = await collection.findOne({ _id: id })
  } catch (error) {
    throw unexpectedPersistenceError(error)
  }

  if (existing === null) {
    return null
  }

  if (existing.status !== PERSISTED_STATUSES.SUBMITTED) {
    throw ineligibleCompletionError()
  }

  throw versionConflictError()
}

/** The two persisted statuses eligible for edit-start - a submitted or completed record may return to
 * `DRAFT`; an already-`DRAFT` record (amended or not) may not. */
const EDIT_START_ELIGIBLE_STATUSES = Object.freeze([
  PERSISTED_STATUSES.SUBMITTED,
  PERSISTED_STATUSES.COMPLETE
])

/**
 * Step 37's one atomic edit-start primitive. Extends the exact same atomic predicate/update shape as
 * `applyCompleteReplacement`/`applySubmission` (status embedded in the predicate alongside
 * id/owner/version), restricted here to the two eligible source statuses via `$in` - a trusted,
 * hard-coded constant array, never built from caller input. Preserves everything else by never
 * `$set`-ing it: `numberOfSubmissions`, `artifacts`, `submittedAt`/`submittedBy`, and
 * `completedAt`/`completedBy` all survive unchanged - this primitive never clones the record and never
 * persists `DRAFT_EDIT`/`AMENDED`.
 *
 * @param {import('mongodb').Db} db
 * @param {{ id: string, ownerUserId: string, expectedVersion: number, updatedAt: string,
 *   updatedBy: string }} params
 * @returns {Promise<import('../domain/canonical-catch-record.js').CatchRecord|null>} The updated
 *   canonical record, or `null` when the record does not exist for this owner.
 * @throws {import('#/common/helpers/errors/application-error.js').ApplicationError}
 *   `INVALID_LIFECYCLE_TRANSITION` or `VERSION_CONFLICT`.
 */
export async function applyEditStart(
  db,
  { id, ownerUserId, expectedVersion, updatedAt, updatedBy }
) {
  assertPlainString(id, 'id')
  assertPlainString(ownerUserId, 'ownerUserId')
  const matchedVersion = validateExpectedVersion(expectedVersion)
  assertPlainString(updatedAt, 'updatedAt')
  assertPlainString(updatedBy, 'updatedBy')

  const collection = getCatchRecordCollection(db)

  let document
  try {
    document = await collection.findOneAndUpdate(
      {
        _id: id,
        ownerUserId,
        status: { $in: EDIT_START_ELIGIBLE_STATUSES },
        version: matchedVersion
      },
      {
        $set: {
          status: PERSISTED_STATUSES.DRAFT,
          hasUnsubmittedChanges: true,
          updatedAt,
          updatedBy
        },
        $inc: { version: 1 }
      },
      { returnDocument: 'after' }
    )
  } catch (error) {
    throw unexpectedPersistenceError(error)
  }

  if (document) {
    return mapStoredDocument(document)
  }

  return classifyEditStartMiss(collection, { id, ownerUserId })
}

/**
 * Classifies why the atomic edit-start update above found no match. Runs only after the write has
 * already failed to match - this diagnostic read never gates, retries, or otherwise controls the write.
 *
 * @param {import('mongodb').Collection} collection
 * @param {{ id: string, ownerUserId: string }} params
 * @returns {Promise<null>}
 * @throws {import('#/common/helpers/errors/application-error.js').ApplicationError}
 */
async function classifyEditStartMiss(collection, { id, ownerUserId }) {
  let existing
  try {
    existing = await collection.findOne({ _id: id, ownerUserId })
  } catch (error) {
    throw unexpectedPersistenceError(error)
  }

  if (existing === null) {
    return null
  }

  if (!EDIT_START_ELIGIBLE_STATUSES.includes(existing.status)) {
    throw ineligibleEditStartError()
  }

  throw versionConflictError()
}

export { ensureCatchRecordIndexes, CATCH_RECORD_COLLECTION }
export { MIN_EXPECTED_VERSION, validateExpectedVersion }
