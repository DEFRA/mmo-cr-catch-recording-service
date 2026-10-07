/**
 * The framework-neutral deterministic artifact-key and artifact-type contract shared by `CatchArtifact`
 * (`catch-artifact.js`), its S3-compatible adapter (`s3-artifact-store.js`), and every caller (Steps
 * 34/35/38). No AWS SDK, Hapi, Boom, Joi, or MongoDB import - a server-generated key is always computed
 * from a stable Catch Record identity and submission number, never accepted from a client, and never
 * built from unvalidated input.
 */

/** The two approved persisted artifact types (`canonical-catch-record-object.md`'s `ArtifactMetadata`
 * JSDoc example) - the same two values recorded in a Catch Record's `artifacts[]` metadata. */
export const ARTIFACT_TYPES = Object.freeze({
  JSON_SNAPSHOT: 'JSON_SNAPSHOT',
  PDF_RECEIPT: 'PDF_RECEIPT'
})

/** The public, URL-facing artifact-type enumeration used by Step 35's retrieval route
 * (`GET .../submissions/{submissionNumber}/{artifactType}`) - an explicit, closed mapping to the
 * persisted type above. No case-insensitive or alias behaviour is supported. */
export const PUBLIC_ARTIFACT_TYPES = Object.freeze({
  json: ARTIFACT_TYPES.JSON_SNAPSHOT,
  pdf: ARTIFACT_TYPES.PDF_RECEIPT
})

const ARTIFACT_TYPE_VALUES = Object.freeze(Object.values(ARTIFACT_TYPES))

const ARTIFACT_FILE_NAMES = Object.freeze({
  [ARTIFACT_TYPES.JSON_SNAPSHOT]: 'snapshot.json',
  [ARTIFACT_TYPES.PDF_RECEIPT]: 'receipt.pdf'
})

const ARTIFACT_CONTENT_TYPES = Object.freeze({
  [ARTIFACT_TYPES.JSON_SNAPSHOT]: 'application/json; charset=utf-8',
  [ARTIFACT_TYPES.PDF_RECEIPT]: 'application/pdf'
})

/** No caller-supplied value ever reaches this guard unvalidated - `catchRecordId` is always the
 * already-validated route parameter used to look up the owner-scoped persisted record beforehand. This
 * pattern does not assume a specific identity format (a real UUID in production, a short literal
 * identifier in tests) - it only excludes path separators, dot-segments, and any other character an
 * S3-compatible object key must never contain, matching the same safety bar the rest of this module's
 * guards apply (bounded length, explicit allow-listed character set). */
const SAFE_ID_PATTERN = /^[0-9a-zA-Z_-]{1,100}$/

const MAX_SUBMISSION_NUMBER = 1000

function assertSafeCatchRecordId(catchRecordId) {
  if (
    typeof catchRecordId !== 'string' ||
    !SAFE_ID_PATTERN.test(catchRecordId)
  ) {
    throw new TypeError(
      '"catchRecordId" must be a safe bounded identifier before it can be used in an artifact key'
    )
  }
}

function assertSafeSubmissionNumber(submissionNumber) {
  if (
    !Number.isInteger(submissionNumber) ||
    submissionNumber <= 0 ||
    submissionNumber > MAX_SUBMISSION_NUMBER
  ) {
    throw new TypeError(
      `"submissionNumber" must be an integer between 1 and ${MAX_SUBMISSION_NUMBER}`
    )
  }
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
export function isSupportedArtifactType(value) {
  return typeof value === 'string' && ARTIFACT_TYPE_VALUES.includes(value)
}

function assertSupportedArtifactType(type) {
  if (!isSupportedArtifactType(type)) {
    throw new TypeError('"type" must be one of the approved artifact types')
  }
}

/**
 * Builds the one deterministic, server-generated, path-traversal-safe object key for a committed
 * artifact. The same `(catchRecordId, submissionNumber, type)` triple always produces the same key -
 * never a client-supplied value, never a random/UUID-per-write key. Distinguishes JSON/PDF by file
 * extension and distinguishes submission versions by path segment, so an earlier committed version can
 * never be addressed by a later write.
 *
 * @param {{ catchRecordId: string, submissionNumber: number, type: string }} input
 * @returns {string}
 */
export function buildArtifactKey({ catchRecordId, submissionNumber, type }) {
  assertSafeCatchRecordId(catchRecordId)
  assertSafeSubmissionNumber(submissionNumber)
  assertSupportedArtifactType(type)

  return `catch-records/${catchRecordId}/submissions/${submissionNumber}/${ARTIFACT_FILE_NAMES[type]}`
}

/**
 * @param {string} type one of {@link ARTIFACT_TYPES}
 * @returns {string} the approved safe content type
 */
export function contentTypeForArtifactType(type) {
  assertSupportedArtifactType(type)
  return ARTIFACT_CONTENT_TYPES[type]
}

/**
 * Maps a public, URL-facing artifact-type segment (`json`/`pdf`) to its persisted type, or `undefined`
 * for anything else. Deliberately an explicit lookup, never a case-folding or alias transform.
 *
 * @param {unknown} publicType
 * @returns {string|undefined}
 */
export function resolvePublicArtifactType(publicType) {
  if (typeof publicType !== 'string') {
    return undefined
  }

  return Object.hasOwn(PUBLIC_ARTIFACT_TYPES, publicType)
    ? PUBLIC_ARTIFACT_TYPES[publicType]
    : undefined
}

const PERSISTED_TO_PUBLIC_ARTIFACT_TYPES = Object.freeze(
  Object.fromEntries(
    Object.entries(PUBLIC_ARTIFACT_TYPES).map(([publicType, persistedType]) => [
      persistedType,
      publicType
    ])
  )
)

/**
 * The inverse of {@link resolvePublicArtifactType}: maps a persisted type back to its public, URL-facing
 * segment, for building the submission-listing response.
 *
 * @param {string} persistedType one of {@link ARTIFACT_TYPES}
 * @returns {string}
 */
export function publicArtifactTypeFor(persistedType) {
  assertSupportedArtifactType(persistedType)
  return PERSISTED_TO_PUBLIC_ARTIFACT_TYPES[persistedType]
}
