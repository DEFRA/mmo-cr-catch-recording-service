import { CANONICAL_SCHEMA_VERSION } from '../domain/canonical-catch-record.js'
import { isPersistedStatus } from '../domain/lifecycle-status.js'

/**
 * The 22 root fields of the Step 05 Canonical Catch Record Object v1 (`CatchRecord` typedef in
 * `src/catch-recording/domain/canonical-catch-record.js`, matching
 * `design/architecture/canonical-catch-record-object.md`'s example). Used only to drive the explicit,
 * field-by-field mapping below — never to spread an object across the persistence boundary.
 */
const NESTED_FIELDS = Object.freeze([
  'vessel',
  'trip',
  'pairFishing',
  'gears',
  'speciesNotLanded',
  'artifacts'
])

const SCALAR_FIELDS = Object.freeze([
  'schemaVersion',
  'catchRecordReference',
  'ownerUserId',
  'status',
  'version',
  'numberOfSubmissions',
  'hasUnsubmittedChanges',
  'createdAt',
  'createdBy',
  'updatedAt',
  'updatedBy',
  'submittedAt',
  'submittedBy',
  'completedAt',
  'completedBy'
])

function cloneNested(value) {
  return structuredClone(value)
}

/**
 * Maps a Canonical Catch Record Object v1 to its MongoDB document representation.
 *
 * The canonical `id` is stored directly as MongoDB `_id` (an owner decision recorded in the Step 09
 * plan): canonical `id` is already a server-generated UUID string supplied by a later trusted
 * application operation, and storing it as `_id` lets MongoDB's own automatic unique index enforce
 * uniqueness with no redundant manual index.
 *
 * Every field is assigned explicitly by name. Nested structures are deep-cloned so the returned
 * document shares no mutable reference with `catchRecord`, and `catchRecord` itself is never mutated.
 * Does not add generated timestamps, actor identifiers, defaults, or any field not present on the
 * canonical contract.
 *
 * @param {import('../domain/canonical-catch-record.js').CatchRecord} catchRecord
 * @returns {object} The MongoDB document to insert/replace.
 */
export function toPersistenceDocument(catchRecord) {
  const document = { _id: catchRecord.id }

  for (const field of SCALAR_FIELDS) {
    document[field] = catchRecord[field]
  }

  for (const field of NESTED_FIELDS) {
    document[field] = cloneNested(catchRecord[field])
  }

  return document
}

function assertNonEmptyString(value, fieldName) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(
      `Stored catch record document has an invalid "${fieldName}" field`
    )
  }
}

/**
 * Maps a stored MongoDB document back to a Canonical Catch Record Object v1.
 *
 * Returns only the approved canonical fields — MongoDB-specific fields (`_id`) and any unknown stored
 * field are excluded, never silently become canonical fields. Nested structures are deep-cloned so the
 * returned record shares no mutable reference with the stored document.
 *
 * Fails safely (throws `TypeError`, caught and translated by the caller into a safe
 * `ApplicationError` — never exposing the stored document) for: a non-object document, an unsupported
 * `schemaVersion` (no fallback, no migration-on-read), a missing/invalid `_id`, `catchRecordReference`,
 * or `ownerUserId`, an unrecognised `status`, or a non-array `gears`. This is a structural safety check,
 * not a re-run of Step 07 business validation.
 *
 * @param {object} document
 * @returns {import('../domain/canonical-catch-record.js').CatchRecord}
 */
export function toCanonicalRecord(document) {
  if (document === null || typeof document !== 'object') {
    throw new TypeError('Stored catch record document is not an object')
  }

  if (document.schemaVersion !== CANONICAL_SCHEMA_VERSION) {
    throw new TypeError(
      'Stored catch record document has an unsupported schemaVersion'
    )
  }

  assertNonEmptyString(document._id, 'id')
  assertNonEmptyString(document.catchRecordReference, 'catchRecordReference')
  assertNonEmptyString(document.ownerUserId, 'ownerUserId')

  if (!isPersistedStatus(document.status)) {
    throw new TypeError('Stored catch record document has an invalid status')
  }

  if (!Array.isArray(document.gears)) {
    throw new TypeError(
      'Stored catch record document has an invalid gears collection'
    )
  }

  const catchRecord = { id: document._id }

  for (const field of SCALAR_FIELDS) {
    catchRecord[field] = document[field]
  }

  for (const field of NESTED_FIELDS) {
    catchRecord[field] = cloneNested(document[field])
  }

  return catchRecord
}
