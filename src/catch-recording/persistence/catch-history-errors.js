import { ApplicationError } from '#/common/helpers/errors/application-error.js'

/**
 * The one place a raw MongoDB history-persistence error is translated into a safe, framework-neutral
 * `ApplicationError`. Mirrors `catch-persistence-errors.js`'s pattern, scoped to history. Never exposes
 * the raw error, collection/database name, query document, or stored event content to a caller.
 *
 * No duplicate-identifier translation exists here: no caller-supplied unique identifier exists on a
 * history event (MongoDB's own auto-generated `_id` guarantees storage-level uniqueness), so no
 * duplicate-identifier conflict is reachable through this module's public API.
 */

/**
 * Builds the safe `ApplicationError` for a stored history document that cannot be mapped back to the
 * framework-neutral contract. Never includes the stored document content.
 *
 * @param {unknown} cause
 * @returns {ApplicationError}
 */
export function malformedHistoryDocumentError(cause) {
  return new ApplicationError({
    category: 'UNEXPECTED_INTERNAL_FAILURE',
    code: 'MALFORMED_HISTORY_EVENT_DOCUMENT',
    message: 'Stored catch record history data could not be read safely.',
    cause
  })
}

/**
 * Builds the safe `ApplicationError` for any other unexpected MongoDB history-persistence failure.
 *
 * @param {unknown} cause
 * @returns {ApplicationError}
 */
export function unexpectedHistoryPersistenceError(cause) {
  return new ApplicationError({
    category: 'UNEXPECTED_INTERNAL_FAILURE',
    code: 'CATCH_RECORD_HISTORY_PERSISTENCE_FAILURE',
    message: 'A catch record history operation could not be completed.',
    cause
  })
}
