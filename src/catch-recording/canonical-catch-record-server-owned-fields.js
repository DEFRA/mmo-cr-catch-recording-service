// Canonical Catch Record Object v1 — server-owned field catalogue (Step 05).
//
// Lists the top-level fields the service itself owns and assigns; a client must never be allowed to set
// or overwrite these via PUT/PATCH — see design/design/catch-recording-service-design.md §9.2
// "Server-owned fields". This module only defines the catalogue; Step 06 implements the actual
// stripping/rejection behaviour that consumes it.
//
// Deliberately excludes `vessel`, `trip`, `pairFishing`, `gear` and `retainedCatch` — those are
// client-supplied/selectable business sections, not wholly server-owned objects.
export const CATCH_RECORD_SERVER_OWNED_FIELDS = Object.freeze([
  'id',
  'catchRecordReference',
  'ownerUserId',
  'status',
  'version',
  'numberOfSubmissions',
  'hasUnsubmittedChanges',
  'audit',
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

export function isServerOwnedField(fieldName) {
  return CATCH_RECORD_SERVER_OWNED_FIELDS.includes(fieldName)
}
