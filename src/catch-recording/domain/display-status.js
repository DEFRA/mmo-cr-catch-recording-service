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

function ownField(catchRecord, field) {
  return Object.hasOwn(catchRecord, field) ? catchRecord[field] : undefined
}

/**
 * Resolves the `Draft`/`Amended` split for a persisted `DRAFT` record. Returns `undefined` for an
 * invalid `numberOfSubmissions` rather than inventing a fallback.
 *
 * @param {unknown} numberOfSubmissions
 * @returns {string|undefined}
 */
function deriveDraftDisplayStatus(numberOfSubmissions) {
  if (!Number.isInteger(numberOfSubmissions) || numberOfSubmissions < 0) {
    return undefined
  }

  return numberOfSubmissions > 0
    ? DISPLAY_STATUSES.AMENDED
    : DISPLAY_STATUSES.DRAFT
}

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
  const status = ownField(catchRecord, 'status')

  if (status === PERSISTED_STATUSES.SUBMITTED) {
    return DISPLAY_STATUSES.SUBMITTED
  }

  if (status === PERSISTED_STATUSES.COMPLETE) {
    return DISPLAY_STATUSES.COMPLETE
  }

  if (status === PERSISTED_STATUSES.DRAFT) {
    return deriveDraftDisplayStatus(
      ownField(catchRecord, 'numberOfSubmissions')
    )
  }

  return undefined
}
