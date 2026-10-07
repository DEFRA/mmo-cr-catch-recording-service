import { ApplicationError } from '#/common/helpers/errors/application-error.js'
import { publicArtifactTypeFor } from '#/catch-recording/artifact/artifact-keys.js'
import { findCatchRecordByIdForOwner } from '#/catch-recording/persistence/catch-persistence.js'

/**
 * Step 35: the `CatchQuery` submission-artifact listing use case (`GET
 * /v1/catch-records/{catchRecordId}/submissions`).
 *
 * Framework-neutral except for the Mongo-backed owner-scoped read it delegates to
 * `CatchPersistence`: never imports the AWS SDK, Hapi, or Boom directly. Read-only - never mutates the
 * record, never calls object storage (listing uses only the already-persisted `artifacts[]` metadata).
 */

function catchRecordNotFoundError() {
  return new ApplicationError({
    category: 'RESOURCE_NOT_FOUND',
    code: 'CATCH_RECORD_NOT_FOUND',
    message: 'The requested catch record could not be found.'
  })
}

/**
 * Groups the flat, persisted `artifacts[]` metadata array by `submissionNumber`. A submission is
 * listable only when **both** approved artifact types are present for it - a partial group (possible
 * only if persisted state is already internally inconsistent, since `applySubmission` always commits
 * both entries together in one atomic write) is excluded defensively rather than surfaced as a false
 * "available" submission.
 *
 * @param {ReadonlyArray<{ submissionNumber: number, type: string, contentType?: string,
 *   contentLength?: number, checksum?: string }>} artifacts
 * @returns {Array<{ submissionNumber: number, artifacts: Array<object> }>} ordered ascending by
 *   `submissionNumber`
 */
function groupCommittedSubmissions(artifacts) {
  const bySubmissionNumber = new Map()

  for (const artifact of artifacts) {
    const group = bySubmissionNumber.get(artifact.submissionNumber) ?? []
    group.push(artifact)
    bySubmissionNumber.set(artifact.submissionNumber, group)
  }

  const submissions = []
  for (const [submissionNumber, group] of bySubmissionNumber) {
    const types = new Set(group.map((artifact) => artifact.type))
    if (types.size !== 2) {
      // Internally inconsistent partial group - excluded rather than listed as available.
      continue
    }

    submissions.push({
      submissionNumber,
      artifacts: group.map((artifact) => ({
        type: publicArtifactTypeFor(artifact.type),
        contentType: artifact.contentType,
        contentLength: artifact.contentLength,
        checksum: artifact.checksum
      }))
    })
  }

  return submissions.sort((a, b) => a.submissionNumber - b.submissionNumber)
}

/**
 * @param {Object} input
 * @param {import('mongodb').Db} input.db
 * @param {{ userId: string, scopes: ReadonlyArray<string> }} input.authenticationContext
 * @param {string} input.catchRecordId
 * @returns {Promise<Readonly<{ catchRecordId: string, count: number, submissions: Array<object> }>>}
 * @throws {ApplicationError} `RESOURCE_NOT_FOUND` when the record does not exist for this owner
 */
export async function listSubmissionArtifacts({
  db,
  authenticationContext,
  catchRecordId
}) {
  const ownerUserId = authenticationContext?.userId

  const catchRecord = await findCatchRecordByIdForOwner(db, {
    id: catchRecordId,
    ownerUserId
  })

  if (!catchRecord) {
    throw catchRecordNotFoundError()
  }

  const submissions = groupCommittedSubmissions(catchRecord.artifacts ?? [])

  return Object.freeze({
    catchRecordId,
    count: submissions.length,
    submissions: Object.freeze(submissions)
  })
}
