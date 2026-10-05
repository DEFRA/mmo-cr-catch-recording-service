/**
 * The framework-neutral idempotency-key contract.
 *
 * Owns: validating the opaque, client-generated idempotency-key primitive a later trusted application
 * operation accepts when adopting targeted idempotency (Step 12 plan, "Idempotency-key contract"). Has
 * no MongoDB, Hapi, or Boom awareness — `catch-idempotency-persistence.js` is the only place a validated
 * key is used to build a MongoDB filter or document.
 *
 * Does not: generate a key, infer a fallback key, trim/transform/case-convert a key, require a UUID or
 * any other format, parse an HTTP header, or decide which operations require a key (that remains each
 * later business operation's own decision — see
 * `design/plans/catch-recording-service-detailed-implementation-plan.md` §5.2).
 */

/**
 * A generous but explicit technical ceiling — no approved business value exists anywhere in the
 * approved plans or canonical Catch Record object document for an idempotency-key length. This exists
 * only so a future caller defect (or a hostile caller) can never produce an unbounded stored value,
 * mirroring the existing `MAX_SUBMISSION_NUMBER`/`MAX_HISTORY_LIST_LIMIT` justification pattern in
 * `catch-history-event.js`/`catch-history-persistence.js`.
 */
export const MAX_IDEMPOTENCY_KEY_LENGTH = 200

/** Printable ASCII only (space through tilde) — rejects every control character, including an embedded
 * NUL, newline, tab, or DEL, which defeats injection-shaped values without inventing a format
 * requirement (no UUID-only rule, no prefix rule). */
const PRINTABLE_ASCII_PATTERN = /^[\x20-\x7E]+$/

/**
 * Shared bounded, printable-token guard. Exported for reuse by the Mongo adapter's `resourceId` guard
 * (same injection-shaped-value protection is needed for both an idempotency key and an explicit resource
 * identity), avoiding a duplicated check in a second file.
 *
 * @param {unknown} value
 * @param {string} fieldName
 * @param {number} maxLength
 * @returns {string} The validated value, returned unchanged — never trimmed, cased, or coerced.
 */
export function assertBoundedPrintableToken(value, fieldName, maxLength) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`"${fieldName}" must be a non-empty string`)
  }

  if (value.length > maxLength) {
    throw new TypeError(
      `"${fieldName}" must not exceed ${maxLength} characters`
    )
  }

  if (!PRINTABLE_ASCII_PATTERN.test(value)) {
    throw new TypeError(
      `"${fieldName}" must contain only printable, non-control characters`
    )
  }

  return value
}

/**
 * Validates the opaque idempotency-key primitive. Treated literally — never used as a collection name,
 * field path, file path, or executable value.
 *
 * @param {unknown} value
 * @returns {string} The validated key, returned unchanged.
 */
export function validateIdempotencyKey(value) {
  return assertBoundedPrintableToken(
    value,
    'idempotencyKey',
    MAX_IDEMPOTENCY_KEY_LENGTH
  )
}
