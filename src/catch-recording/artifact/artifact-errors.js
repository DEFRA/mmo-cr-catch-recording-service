import { ApplicationError } from '#/common/helpers/errors/application-error.js'

/**
 * The one place a raw S3-compatible SDK failure is translated into a safe, framework-neutral
 * `ApplicationError`. Reuses the existing `ARTIFACT_OPERATION_FAILURE` category (already approved in
 * `error-categories.js` ahead of this step) - no new category is introduced. Never exposes the raw SDK
 * error, bucket name, object key, or endpoint to a caller.
 */

export function artifactWriteFailedError(cause) {
  return new ApplicationError({
    category: 'ARTIFACT_OPERATION_FAILURE',
    code: 'ARTIFACT_WRITE_FAILED',
    message: 'The submission artifact could not be stored.',
    cause
  })
}

/**
 * The write succeeded but post-write verification (existence/size/checksum) did not confirm it -
 * distinct from a hard write failure because the object may now exist in an unconfirmed state; retried
 * submission recovery (Step 34) decides how to proceed, this error only reports the fact.
 *
 * @param {unknown} [cause]
 */
export function artifactVerificationFailedError(cause) {
  return new ApplicationError({
    category: 'ARTIFACT_OPERATION_FAILURE',
    code: 'ARTIFACT_VERIFICATION_FAILED',
    message: 'The submission artifact could not be verified after writing.',
    cause
  })
}

/**
 * A committed artifact already exists at this deterministic key with different content than the bytes
 * now being written. This must never happen for a correctly functioning caller (the same submission
 * number is never reused for different content) - it is reported as a safe integrity failure rather
 * than silently overwriting immutable evidence.
 */
export function artifactIntegrityConflictError() {
  return new ApplicationError({
    category: 'ARTIFACT_OPERATION_FAILURE',
    code: 'ARTIFACT_INTEGRITY_CONFLICT',
    message:
      'A different artifact already exists for this submission and could not be safely replaced.'
  })
}

/**
 * The requested committed artifact does not exist in object storage (as distinct from existing but
 * failing integrity verification). Reuses the existing `RESOURCE_NOT_FOUND` category.
 */
export function artifactNotFoundError() {
  return new ApplicationError({
    category: 'RESOURCE_NOT_FOUND',
    code: 'CATCH_ARTIFACT_NOT_FOUND',
    message: 'The requested submission artifact could not be found.'
  })
}

/**
 * Any other unexpected object-storage retrieval failure (network error, malformed response, dependency
 * unavailability while reading).
 *
 * @param {unknown} [cause]
 */
export function artifactRetrievalFailedError(cause) {
  return new ApplicationError({
    category: 'ARTIFACT_OPERATION_FAILURE',
    code: 'ARTIFACT_RETRIEVAL_FAILED',
    message: 'The requested submission artifact could not be retrieved.',
    cause
  })
}
