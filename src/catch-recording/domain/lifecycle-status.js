/**
 * The approved persisted Catch Record lifecycle statuses.
 *
 * Only these three values may ever be persisted. `DRAFT_EDIT`, `AMENDED`, `ABANDONED`, and
 * `WITHDRAWN` must never be persisted statuses — `Amended` is a derived display state only (owned by
 * Step 08), calculated from `status === 'DRAFT' && numberOfSubmissions > 0`, never stored as a status
 * value.
 */
export const PERSISTED_STATUSES = Object.freeze({
  DRAFT: 'DRAFT',
  SUBMITTED: 'SUBMITTED',
  COMPLETE: 'COMPLETE'
})

const PERSISTED_STATUS_VALUES = Object.freeze(Object.values(PERSISTED_STATUSES))

/**
 * Reliable membership check for a persisted status value.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export function isPersistedStatus(value) {
  return typeof value === 'string' && PERSISTED_STATUS_VALUES.includes(value)
}
