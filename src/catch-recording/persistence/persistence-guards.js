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
  if (!Number.isInteger(value)) {
    throw new TypeError(`"limit" must be an integer between 1 and ${maxLimit}`)
  }

  const integerValue = /** @type {number} */ (value)

  if (integerValue <= 0 || integerValue > maxLimit) {
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

/** The audit-metadata fields every section update also refreshes alongside its one section field -
 * matches `AUDIT_METADATA_ALLOWED_FIELDS` in `catch-persistence.js` so a section save and a pure
 * audit-metadata update stay governed by the same server-owned-field contract. */
const SECTION_UPDATE_AUDIT_FIELDS = Object.freeze(['updatedAt', 'updatedBy'])

function assertChangesIsPlainObject(changes) {
  if (
    changes === null ||
    typeof changes !== 'object' ||
    Array.isArray(changes)
  ) {
    throw new TypeError('"changes" must be a plain object')
  }
}

function assertAuditFieldsPresent(changes) {
  for (const auditField of SECTION_UPDATE_AUDIT_FIELDS) {
    if (!Object.hasOwn(changes, auditField)) {
      throw new TypeError(`"changes" must include "${auditField}"`)
    }
    assertPlainString(changes[auditField], auditField)
  }
}

function assertExactlyOneSectionKey(changes) {
  const sectionKeys = Object.keys(changes).filter(
    (key) => !SECTION_UPDATE_AUDIT_FIELDS.includes(key)
  )

  if (sectionKeys.length !== 1) {
    throw new TypeError(
      '"changes" must include exactly one section field alongside the audit-metadata fields'
    )
  }

  return sectionKeys[0]
}

function assertSectionKeyAllowed(sectionKey, allowedSectionFields) {
  if (
    DISALLOWED_CHANGE_KEYS.includes(sectionKey) ||
    !allowedSectionFields.includes(sectionKey)
  ) {
    throw new TypeError(`"${sectionKey}" is not an allowed section field`)
  }
}

/**
 * Rejects a `sectionValue` unless it is a plain object or an array - a canonical section is either a
 * single nested object (`trip`, `pairFishing`) or an ordered collection (`gears`, the first
 * collection-valued section, approved by Step 23). Still rejects `null` and any scalar outright. When
 * the value is a plain object (not an array), also rejects an own `__proto__`/`constructor`/`prototype`
 * key, defensively - the same belt-and-braces protection `assertAllowedChanges` already applies to its
 * own keys. An array's own elements are never inspected here: only an already-normalised/validated
 * caller ever builds a section value, so this guard polices only the top-level shape and keys that may
 * ever reach a MongoDB `$set`, never re-validates section content.
 *
 * @param {string} sectionKey
 * @param {unknown} sectionValue
 */
function assertSectionValueIsPlainObject(sectionKey, sectionValue) {
  if (sectionValue === null || typeof sectionValue !== 'object') {
    throw new TypeError(`"${sectionKey}" must be a plain object or an array`)
  }

  if (Array.isArray(sectionValue)) {
    return
  }

  for (const disallowedKey of DISALLOWED_CHANGE_KEYS) {
    if (Object.hasOwn(sectionValue, disallowedKey)) {
      throw new TypeError(
        `"${sectionKey}" must not contain a "${disallowedKey}" key`
      )
    }
  }
}

/**
 * Rejects a section-update `changes` object unless it is exactly `{ updatedAt, updatedBy, [section]:
 * <plain object|array> }` - the two trusted audit-metadata strings, plus exactly one allow-listed
 * section field whose own value is itself a plain object or an array (see
 * `assertSectionValueIsPlainObject`). Unlike `assertAllowedChanges` (string-valued audit fields only),
 * this guard exists because a section's *value* is a nested structure the caller already
 * normalised/validated - this guard only polices which *keys* may ever reach a MongoDB `$set`, never
 * re-validates section content.
 *
 * @param {unknown} changes
 * @param {ReadonlyArray<string>} allowedSectionFields
 */
export function assertSectionChanges(changes, allowedSectionFields) {
  assertChangesIsPlainObject(changes)
  assertAuditFieldsPresent(changes)

  const sectionKey = assertExactlyOneSectionKey(changes)
  assertSectionKeyAllowed(sectionKey, allowedSectionFields)
  assertSectionValueIsPlainObject(sectionKey, changes[sectionKey])
}
