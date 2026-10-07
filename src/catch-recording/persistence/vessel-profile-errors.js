import { ApplicationError } from '#/common/helpers/errors/application-error.js'

const DUPLICATE_KEY_ERROR_CODE = 11000

/**
 * The one place a raw MongoDB vessel-profile error is translated into a safe, framework-neutral
 * `ApplicationError`. Mirrors `catch-persistence-errors.js`/`catch-idempotency-errors.js`'s pattern,
 * scoped to vessel profiles. Never exposes the raw error, collection/database name, query/update
 * document, or stored profile content to a caller.
 */

/**
 * @param {unknown} error
 * @returns {boolean}
 */
export function isDuplicateProfileKeyError(error) {
  return Boolean(error) && error.code === DUPLICATE_KEY_ERROR_CODE
}

/**
 * Builds the safe `ApplicationError` for a stored vessel-profile document that cannot be mapped back to
 * the canonical representation. Never includes the stored document content.
 *
 * @param {unknown} cause
 * @returns {ApplicationError}
 */
export function malformedVesselProfileDocumentError(cause) {
  return new ApplicationError({
    category: 'UNEXPECTED_INTERNAL_FAILURE',
    code: 'MALFORMED_VESSEL_PROFILE_DOCUMENT',
    message: 'Stored vessel-profile data could not be read safely.',
    cause
  })
}

/**
 * Builds the safe `ApplicationError` for any other unexpected MongoDB vessel-profile persistence
 * failure.
 *
 * @param {unknown} cause
 * @returns {ApplicationError}
 */
export function unexpectedVesselProfilePersistenceError(cause) {
  return new ApplicationError({
    category: 'UNEXPECTED_INTERNAL_FAILURE',
    code: 'VESSEL_PROFILE_PERSISTENCE_FAILURE',
    message: 'A vessel-profile operation could not be completed.',
    cause
  })
}
