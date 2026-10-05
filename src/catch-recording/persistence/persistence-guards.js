/**
 * The one shared injection/allow-list guard used by every `CatchPersistence` operation before any
 * MongoDB filter or update document is built. Every exported operation in `catch-persistence.js` calls
 * these guards first — a disallowed value never reaches a Mongo call.
 *
 * Throws a plain `TypeError` on failure (a programming-contract violation by a trusted internal
 * caller, never a public-facing `ApplicationError` — `CatchPersistence` has no HTTP awareness).
 */

const DISALLOWED_CHANGE_KEYS = Object.freeze([
  '__proto__',
  'constructor',
  'prototype'
])

/**
 * Rejects anything that is not a non-empty string, defeating operator-injection payloads such as
 * `{ $ne: null }`, `{ $where: '...' }`, or a regular-expression object being substituted for a scalar
 * filter value.
 *
 * @param {unknown} value
 * @param {string} fieldName
 */
export function assertPlainString(value, fieldName) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`"${fieldName}" must be a non-empty string`)
  }
}

/**
 * Rejects a `limit` that is not a safe, bounded positive integer.
 *
 * @param {unknown} value
 * @param {number} maxLimit
 */
export function assertSafeListLimit(value, maxLimit) {
  if (!Number.isInteger(value) || value <= 0 || value > maxLimit) {
    throw new TypeError(`"limit" must be an integer between 1 and ${maxLimit}`)
  }
}

/**
 * Rejects an update-changes object unless every key is on the explicit allow-list and every value is a
 * non-empty string. Rejects `__proto__`/`constructor`/`prototype` defensively (belt-and-braces against
 * prototype pollution), even though those keys could never match a real allow-list entry.
 *
 * @param {unknown} changes
 * @param {ReadonlyArray<string>} allowedFields
 */
export function assertAllowedChanges(changes, allowedFields) {
  if (
    changes === null ||
    typeof changes !== 'object' ||
    Array.isArray(changes)
  ) {
    throw new TypeError('"changes" must be a plain object')
  }

  const keys = Object.keys(changes)

  if (keys.length === 0) {
    throw new TypeError('"changes" must include at least one allowed field')
  }

  for (const key of keys) {
    if (DISALLOWED_CHANGE_KEYS.includes(key) || !allowedFields.includes(key)) {
      throw new TypeError(`"${key}" is not an allowed update field`)
    }

    assertPlainString(changes[key], key)
  }
}
