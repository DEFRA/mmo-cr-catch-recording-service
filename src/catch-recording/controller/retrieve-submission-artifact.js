import { ApplicationError } from '#/common/helpers/errors/application-error.js'
import {
  ARTIFACT_TYPES,
  contentTypeForArtifactType,
  resolvePublicArtifactType
} from '#/catch-recording/artifact/artifact-keys.js'
import { retrieveCommittedArtifact } from '#/catch-recording/artifact/catch-artifact.js'
import { findCatchRecordByIdForOwner } from '#/catch-recording/persistence/catch-persistence.js'

/**
 * Step 35: the `CatchQuery` single-artifact retrieval use case (`GET
 * /v1/catch-records/{catchRecordId}/submissions/{submissionNumber}/{artifactType}`).
 *
 * Verifies committed artifact association against the Catch Record's own trusted `artifacts[]`
 * metadata *before* ever calling object storage - a storage key is always recomputed deterministically
 * from trusted inputs (`CatchArtifact`), never accepted from or influenced by the client.
 */

const ARTIFACT_FILE_EXTENSIONS = Object.freeze({
  [ARTIFACT_TYPES.JSON_SNAPSHOT]: 'json',
  [ARTIFACT_TYPES.PDF_RECEIPT]: 'pdf'
})

/** Strips everything outside a small safe character set - defence in depth even though
 * `catchRecordReference` is already server-generated from a known-safe alphabet. Prevents CRLF
 * injection, path separators, and parent-traversal sequences from ever reaching a response header. */
const UNSAFE_FILENAME_CHARACTERS = /[^A-Za-z0-9-]/g

function catchRecordNotFoundError() {
  return new ApplicationError({
    category: 'RESOURCE_NOT_FOUND',
    code: 'CATCH_RECORD_NOT_FOUND',
    message: 'The requested catch record could not be found.'
  })
}

function unsupportedArtifactTypeError() {
  return new ApplicationError({
    category: 'INVALID_REQUEST',
    code: 'UNSUPPORTED_ARTIFACT_TYPE',
    message: 'The requested artifact type is not supported.'
  })
}

function artifactNotCommittedError() {
  return new ApplicationError({
    category: 'RESOURCE_NOT_FOUND',
    code: 'CATCH_ARTIFACT_NOT_FOUND',
    message: 'The requested submission artifact could not be found.'
  })
}

function buildSafeFilename({ catchRecordReference, submissionNumber, type }) {
  const safeReference = catchRecordReference.replace(
    UNSAFE_FILENAME_CHARACTERS,
    ''
  )
  const extension = ARTIFACT_FILE_EXTENSIONS[type]
  return `${safeReference}-submission-${submissionNumber}.${extension}`
}

/**
 * @param {Object} input
 * @param {import('mongodb').Db} input.db
 * @param {object} input.catchArtifactStore the Step 33 `CatchArtifact` storage adapter
 * @param {{ userId: string, scopes: ReadonlyArray<string> }} input.authenticationContext
 * @param {string} input.catchRecordId
 * @param {number} input.submissionNumber
 * @param {unknown} input.artifactType the public `json`/`pdf` URL segment
 * @returns {Promise<Readonly<{ body: Buffer, contentType: string, contentLength: number,
 *   filename: string }>>}
 * @throws {ApplicationError} `RESOURCE_NOT_FOUND` / `INVALID_REQUEST`
 */
export async function retrieveSubmissionArtifact({
  db,
  catchArtifactStore,
  authenticationContext,
  catchRecordId,
  submissionNumber,
  artifactType
}) {
  const type = resolvePublicArtifactType(artifactType)
  if (!type) {
    throw unsupportedArtifactTypeError()
  }

  const ownerUserId = authenticationContext?.userId

  const catchRecord = await findCatchRecordByIdForOwner(db, {
    id: catchRecordId,
    ownerUserId
  })

  if (!catchRecord) {
    throw catchRecordNotFoundError()
  }

  const isCommitted = (catchRecord.artifacts ?? []).some(
    (artifact) =>
      artifact.submissionNumber === submissionNumber && artifact.type === type
  )

  if (!isCommitted) {
    throw artifactNotCommittedError()
  }

  const { body } = await retrieveCommittedArtifact(catchArtifactStore, {
    catchRecordId,
    submissionNumber,
    type
  })

  return Object.freeze({
    body,
    contentType: contentTypeForArtifactType(type),
    contentLength: body.length,
    filename: buildSafeFilename({
      catchRecordReference: catchRecord.catchRecordReference,
      submissionNumber,
      type
    })
  })
}
