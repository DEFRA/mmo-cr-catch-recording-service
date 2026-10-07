import { getCatchRecordCollection } from './catch-record-collection.js'
import { toCanonicalRecord } from './catch-record-mapper.js'
import { assertPlainString } from './persistence-guards.js'
import {
  unexpectedPersistenceError,
  malformedDocumentError,
  versionConflictError,
  ineligibleSubmissionError,
  ineligibleCompletionError,
  ineligibleEditStartError
} from './catch-persistence-errors.js'
import { validateExpectedVersion } from './expected-version.js'
import { PERSISTED_STATUSES } from '../domain/lifecycle-status.js'

/**
 * `CatchPersistence`'s Step 34/36/37 lifecycle-commitment primitives (`applySubmission`,
 * `applyCompletion`, `applyEditStart`). Split out of `catch-persistence.js` (re-exported from there
 * unchanged, so every existing import site is unaffected) purely to keep that file's own length within
 * the approved bound — this remains the same `CatchPersistence` module boundary: every operation here
 * still guards its scalar inputs with `persistence-guards.js`/`expected-version.js` before building any
 * MongoDB filter or update document, maps explicitly via `catch-record-mapper.js`, and translates every
 * MongoDB failure via `catch-persistence-errors.js` — no raw MongoDB error, filter, update document, or
 * document content ever reaches a caller. See `docs/catch-recording-persistence.md` for the full
 * contract.
 */

function mapStoredDocument(document) {
  try {
    return toCanonicalRecord(document)
  } catch (cause) {
    throw malformedDocumentError(cause)
  }
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
