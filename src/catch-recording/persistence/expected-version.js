/**
 * The framework-neutral expected-version contract used by every existing-record Catch Record mutation.
 *
 * Owns: validating the expected-version primitive a caller must supply when mutating an existing Catch
 * Record. Required for every state-changing operation on an existing Catch Record; never required for
 * initial creation of a new one. Has no MongoDB, Hapi, or Boom awareness — translating a failed match
 * into a safe not-found/version-conflict outcome is owned by `catch-persistence.js`/
 * `catch-persistence-errors.js`, not this module.
 *
 * Does not: generate the next version (MongoDB's `$inc` is the only place a version is produced),
 * decide HTTP transport representation (headers/ETag/`If-Match` remain an unapproved, deferred
 * decision), or implement idempotency, business validation, or lifecycle eligibility.
 */

/**
 * The lowest value a caller can ever legitimately have observed. The Step 05 canonical contract's
 * `newDraftExample` fixture (and every other newly created Catch Record) starts at `version: 1` — there
 * is no persisted Catch Record with a lower version to expect.
 */
export const MIN_EXPECTED_VERSION = 1

/**
 * Validates the expected-version primitive a caller supplies when mutating an existing Catch Record.
 *
 * Rejects (throws `TypeError`) anything that is not a safe-integer `number` greater than or equal to
 * {@link MIN_EXPECTED_VERSION}. This single guard already covers every disallowed input the approved
 * contract lists: a missing value (`undefined`), `null`, a fractional value, `NaN`, `Infinity`/
 * `-Infinity`, an unsafe integer, a numeric string, an object, an array, and an operator-like structure
 * such as `{ $gt: 0 }` — none of those has `typeof value === 'number'` except the numeric ones, which
 * `Number.isSafeInteger` itself rejects.
 *
 * Does not mutate `value`. Never silently defaults, rounds, truncates, or coerces a near-miss value.
 *
 * @param {unknown} value
 * @returns {number} The validated expected version, returned unchanged.
 */
export function validateExpectedVersion(value) {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < MIN_EXPECTED_VERSION
  ) {
    throw new TypeError(
      `"expectedVersion" must be a safe integer greater than or equal to ${MIN_EXPECTED_VERSION}`
    )
  }

  return value
}
