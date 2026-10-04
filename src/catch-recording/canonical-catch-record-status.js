// Canonical Catch Record Object v1 — persisted lifecycle statuses (Step 05).
//
// Only these three statuses may ever be persisted. `Amended` is a future derived display status
// (status === DRAFT && numberOfSubmissions > 0) and is never itself persisted. `DRAFT_EDIT`, `ABANDONED`
// and `WITHDRAWN` are not approved persisted statuses — see
// design/design/catch-recording-service-design.md §8.1.
export const CATCH_RECORD_STATUS = Object.freeze({
  DRAFT: 'DRAFT',
  SUBMITTED: 'SUBMITTED',
  COMPLETE: 'COMPLETE'
})

export const CATCH_RECORD_STATUSES = Object.freeze(
  Object.values(CATCH_RECORD_STATUS)
)

export function isCatchRecordStatus(value) {
  return CATCH_RECORD_STATUSES.includes(value)
}
