import {
  ARTIFACT_TYPES,
  buildArtifactKey,
  contentTypeForArtifactType
} from './artifact-keys.js'

/**
 * `CatchArtifact`: the framework-neutral port over immutable submission-artifact storage. Depends only
 * on a small injected `store` interface (`{ commitArtifact, retrieveArtifact }`, built by
 * `s3-artifact-store.js`) - never imports the AWS SDK, Hapi, Boom, Joi, or MongoDB directly
 * (`architecture-boundary.test.js` enforces this). Generates every object key itself
 * (`artifact-keys.js`) - a caller never supplies or constructs a storage key.
 */

/**
 * Commits both artifacts for one successful submission or resubmission: the immutable canonical JSON
 * snapshot and the PDF receipt generated from that same snapshot. Both commits use the same deterministic
 * `submissionNumber` - never two different numbers for one submission event. Returns the exact
 * `ArtifactMetadata[]` shape the canonical Catch Record persists (`{ submissionNumber, type }`, plus safe
 * additional integrity fields the structural validator already permits).
 *
 * @param {object} store the injected storage adapter
 * @param {{ catchRecordId: string, submissionNumber: number, jsonBody: Buffer, pdfBody: Buffer }} input
 * @returns {Promise<ReadonlyArray<{ submissionNumber: number, type: string, contentType: string,
 *   contentLength: number, checksum: string }>>}
 */
export async function storeSubmissionArtifacts(
  store,
  { catchRecordId, submissionNumber, jsonBody, pdfBody }
) {
  const jsonKey = buildArtifactKey({
    catchRecordId,
    submissionNumber,
    type: ARTIFACT_TYPES.JSON_SNAPSHOT
  })
  const pdfKey = buildArtifactKey({
    catchRecordId,
    submissionNumber,
    type: ARTIFACT_TYPES.PDF_RECEIPT
  })

  // Sequential, not parallel: a JSON-snapshot write failure must never leave an orphaned PDF write (or
  // vice versa) racing against it - deterministic recovery (Step 34) relies on each artifact's own
  // commit outcome being independently observable in a fixed order.
  const jsonResult = await store.commitArtifact({
    key: jsonKey,
    body: jsonBody,
    contentType: contentTypeForArtifactType(ARTIFACT_TYPES.JSON_SNAPSHOT)
  })
  const pdfResult = await store.commitArtifact({
    key: pdfKey,
    body: pdfBody,
    contentType: contentTypeForArtifactType(ARTIFACT_TYPES.PDF_RECEIPT)
  })

  return Object.freeze([
    buildArtifactMetadata(
      submissionNumber,
      ARTIFACT_TYPES.JSON_SNAPSHOT,
      jsonResult
    ),
    buildArtifactMetadata(
      submissionNumber,
      ARTIFACT_TYPES.PDF_RECEIPT,
      pdfResult
    )
  ])
}

function buildArtifactMetadata(submissionNumber, type, result) {
  return Object.freeze({
    submissionNumber,
    type,
    contentType: result.contentType,
    contentLength: result.contentLength,
    checksum: result.checksum
  })
}

/**
 * Retrieves one committed artifact's exact bytes by Catch Record, submission number, and approved
 * artifact type. Never accepts a storage key directly - the key is always recomputed deterministically
 * from these three trusted values, so a caller can never retrieve an arbitrary object.
 *
 * @param {object} store the injected storage adapter
 * @param {{ catchRecordId: string, submissionNumber: number, type: string }} input
 * @returns {Promise<{ body: Buffer, contentType: string, contentLength: number, checksum: string }>}
 */
export async function retrieveCommittedArtifact(
  store,
  { catchRecordId, submissionNumber, type }
) {
  const key = buildArtifactKey({ catchRecordId, submissionNumber, type })
  return store.retrieveArtifact(key)
}

export { ARTIFACT_TYPES }
