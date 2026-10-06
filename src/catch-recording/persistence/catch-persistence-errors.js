import { ApplicationError } from '#/common/helpers/errors/application-error.js'

const DUPLICATE_KEY_ERROR_CODE = 11000

/**
 * The one place a raw MongoDB error is translated into a safe, framework-neutral `ApplicationError`.
 * Never exposes the raw error, the collection/database name, the query/update document, or the stored
 * record to a caller. `cause` carries the original error only as `ApplicationError`'s own internal,
 * non-enumerable diagnostic field — never serialised or logged in full.
 */

function isDuplicateKeyError(error) {
  return Boolean(error) && error.code === DUPLICATE_KEY_ERROR_CODE
}

function duplicateKeyPattern(error) {
  return error?.keyPattern ?? {}
}

/**
 * Translates an `insertOne` failure. Distinguishes a duplicate internal ID (`_id`) from a duplicate
 * friendly reference (`catchRecordReference`) using the driver's own `keyPattern`, without exposing any
 * other detail of the raw error.
 *
 * @param {unknown} error
 * @returns {ApplicationError}
 */
export function translateInsertError(error) {
  if (isDuplicateKeyError(error)) {
    const keyPattern = duplicateKeyPattern(error)

    if (Object.hasOwn(keyPattern, '_id')) {
      return new ApplicationError({
        category: 'DUPLICATE_RESOURCE',
        code: 'DUPLICATE_CATCH_RECORD_ID',
        message: 'A catch record with this identifier already exists.',
        cause: error
      })
    }

    if (Object.hasOwn(keyPattern, 'catchRecordReference')) {
      return new ApplicationError({
        category: 'DUPLICATE_RESOURCE',
        code: 'DUPLICATE_CATCH_RECORD_REFERENCE',
        message: 'A catch record with this reference already exists.',
        cause: error
      })
    }
  }

  return unexpectedPersistenceError(error)
}

/**
 * Builds the safe `ApplicationError` for a stored document that cannot be mapped back to the canonical
 * contract. Never includes the stored document content.
 *
 * @param {unknown} cause
 * @returns {ApplicationError}
 */
export function malformedDocumentError(cause) {
  return new ApplicationError({
    category: 'UNEXPECTED_INTERNAL_FAILURE',
    code: 'MALFORMED_CATCH_RECORD_DOCUMENT',
    message: 'Stored catch record data could not be read safely.',
    cause
  })
}

/**
 * Builds the safe `ApplicationError` for any other unexpected MongoDB operation failure.
 *
 * @param {unknown} cause
 * @returns {ApplicationError}
 */
export function unexpectedPersistenceError(cause) {
  return new ApplicationError({
    category: 'UNEXPECTED_INTERNAL_FAILURE',
    code: 'CATCH_RECORD_PERSISTENCE_FAILURE',
    message: 'A catch record operation could not be completed.',
    cause
  })
}

/**
 * Builds the safe, deterministic `ApplicationError` for Step 19's eligible-draft-abandonment precondition
 * failure: an owner-scoped Catch Record exists, but it is not (or is no longer) a never-submitted
 * `DRAFT`. Reuses the existing (Step 03) `INVALID_LIFECYCLE_TRANSITION` category — no new category is
 * added. Never includes the record ID, owner ID, or its current status/submission state.
 *
 * @returns {ApplicationError}
 */
export function ineligibleAbandonmentError() {
  return new ApplicationError({
    category: 'INVALID_LIFECYCLE_TRANSITION',
    code: 'CATCH_RECORD_ABANDONMENT_INELIGIBLE',
    message: 'Only a never-submitted draft catch record may be abandoned.'
  })
}

/**
 * Builds the safe, deterministic `ApplicationError` for an optimistic-concurrency conflict: an
 * owner-scoped Catch Record exists, but its stored `version` no longer matches the caller's supplied
 * expected version. Reuses the existing (Step 03) `VERSION_CONFLICT` category — no new category is
 * added. Never includes the record ID, owner ID, the expected version, or the current stored version —
 * this is a deterministic business-outcome branch, not a translated driver failure, so no `cause` is
 * attached.
 *
 * @returns {ApplicationError}
 */
export function versionConflictError() {
  return new ApplicationError({
    category: 'VERSION_CONFLICT',
    code: 'CATCH_RECORD_VERSION_CONFLICT',
    message:
      'The catch record was changed by another request. Reload and retry.'
  })
}
