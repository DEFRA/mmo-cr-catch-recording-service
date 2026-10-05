/**
 * The one source of truth for which top-level Canonical Catch Record Object fields are server-owned.
 *
 * Clients must never be able to set or overwrite these fields through a `PUT`/`PATCH` payload. Step 06
 * (input normalisation) is the module that enforces this catalogue; later steps must import and reuse
 * it rather than duplicating the list.
 */
export const SERVER_OWNED_FIELDS = Object.freeze([
  'schemaVersion',
  'id',
  'catchRecordReference',
  'ownerUserId',
  'status',
  'version',
  'numberOfSubmissions',
  'hasUnsubmittedChanges',
  'artifacts',
  'createdAt',
  'createdBy',
  'updatedAt',
  'updatedBy',
  'submittedAt',
  'submittedBy',
  'completedAt',
  'completedBy'
])

const SERVER_OWNED_FIELD_SET = new Set(SERVER_OWNED_FIELDS)

/**
 * Reliable membership check for a top-level server-owned field name.
 *
 * @param {unknown} fieldName
 * @returns {boolean}
 */
export function isServerOwnedField(fieldName) {
  return typeof fieldName === 'string' && SERVER_OWNED_FIELD_SET.has(fieldName)
}
