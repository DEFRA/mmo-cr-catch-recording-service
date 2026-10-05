import { ApplicationError } from '#/common/helpers/errors/application-error.js'

const DUPLICATE_KEY_ERROR_CODE = 11000

/**
 * The one place a raw MongoDB idempotency-claim error is translated into a safe, framework-neutral
 * `ApplicationError`. Mirrors `catch-persistence-errors.js`/`catch-history-errors.js`'s pattern, scoped
 * to idempotency claims. Never exposes the raw error, collection/database name, query/update document,
 * stored result, fingerprint, or idempotency key to a caller.
 *
 * Reuses the existing (Step 03) `IDEMPOTENCY_CONFLICT` category — no new category is added.
 */

/**
 * @param {unknown} error
 * @returns {boolean}
 */
export function isDuplicateIdempotencyClaimError(error) {
  return Boolean(error) && error.code === DUPLICATE_KEY_ERROR_CODE
}

/**
 * Builds the safe, deterministic `ApplicationError` for a scoped idempotency key reused with a different
 * request fingerprint, or a completed claim that cannot be overwritten with a conflicting result. A
 * deterministic business-outcome branch, not a translated driver failure — no `cause` is attached, and no
 * record content, fingerprint, or caller identity is included.
 *
 * @returns {ApplicationError}
 */
export function idempotencyConflictError() {
  return new ApplicationError({
    category: 'IDEMPOTENCY_CONFLICT',
    code: 'IDEMPOTENCY_REQUEST_MISMATCH',
    message:
      'This idempotency key has already been used for a different request.'
  })
}

/**
 * Builds the safe `ApplicationError` for a completion attempt with no matching prior claim. Completion
 * must only ever follow a successful `claimIdempotency` call — this signals a contract-sequencing
 * anomaly, not a business outcome a caller can resolve by retrying with a different fingerprint.
 *
 * @returns {ApplicationError}
 */
export function idempotencyClaimNotFoundError() {
  return new ApplicationError({
    category: 'UNEXPECTED_INTERNAL_FAILURE',
    code: 'IDEMPOTENCY_CLAIM_NOT_FOUND',
    message: 'The idempotency claim required for completion could not be found.'
  })
}

/**
 * Builds the safe `ApplicationError` for a stored idempotency-claim document that cannot be mapped back
 * to the framework-neutral contract. Never includes the stored document content.
 *
 * @param {unknown} cause
 * @returns {ApplicationError}
 */
export function malformedIdempotencyClaimDocumentError(cause) {
  return new ApplicationError({
    category: 'UNEXPECTED_INTERNAL_FAILURE',
    code: 'MALFORMED_IDEMPOTENCY_CLAIM_DOCUMENT',
    message: 'Stored idempotency data could not be read safely.',
    cause
  })
}

/**
 * Builds the safe `ApplicationError` for any other unexpected MongoDB idempotency-persistence failure.
 *
 * @param {unknown} cause
 * @returns {ApplicationError}
 */
export function unexpectedIdempotencyPersistenceError(cause) {
  return new ApplicationError({
    category: 'UNEXPECTED_INTERNAL_FAILURE',
    code: 'IDEMPOTENCY_PERSISTENCE_FAILURE',
    message: 'An idempotency operation could not be completed.',
    cause
  })
}
