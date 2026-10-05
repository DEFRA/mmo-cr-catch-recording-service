import { PERSISTED_STATUSES } from './lifecycle-status.js'

/**
 * The approved derived display statuses. Never persisted — always calculated on demand from `status`
 * and `numberOfSubmissions`.
 */
export const DISPLAY_STATUSES = Object.freeze({
  DRAFT: 'Draft',
  AMENDED: 'Amended',
  SUBMITTED: 'Submitted',
  COMPLETE: 'Complete'
})

/**
 * Derives the approved display status from `status` and `numberOfSubmissions`:
 * - `DRAFT` with zero submissions -> `Draft`.
 * - `DRAFT` with one or more submissions -> `Amended`.
 * - `SUBMITTED` -> `Submitted`.
 * - `COMPLETE` -> `Complete`.
 *
 * Returns `undefined` for an unsupported status or an invalid `numberOfSubmissions` rather than
 * inventing a fallback display status such as `"Unknown"`.
 *
 * @param {unknown} catchRecord
 * @returns {string|undefined}
 */
export function deriveDisplayStatus(catchRecord) {
  if (typeof catchRecord !== 'object' || catchRecord === null) {
    return undefined
  }

  // Read only own properties - an inherited (prototype-chain) status/count must never be trusted.
  const status = Object.hasOwn(catchRecord, 'status')
    ? catchRecord.status
    : undefined
  const numberOfSubmissions = Object.hasOwn(catchRecord, 'numberOfSubmissions')
    ? catchRecord.numberOfSubmissions
    : undefined

  if (status === PERSISTED_STATUSES.SUBMITTED) {
    return DISPLAY_STATUSES.SUBMITTED
  }

  if (status === PERSISTED_STATUSES.COMPLETE) {
    return DISPLAY_STATUSES.COMPLETE
  }

  if (status === PERSISTED_STATUSES.DRAFT) {
    if (!Number.isInteger(numberOfSubmissions) || numberOfSubmissions < 0) {
      return undefined
    }

    return numberOfSubmissions > 0
      ? DISPLAY_STATUSES.AMENDED
      : DISPLAY_STATUSES.DRAFT
  }

  return undefined
}
