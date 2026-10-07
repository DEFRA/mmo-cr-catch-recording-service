import { VALIDATION_CODES } from '../validation-codes.js'
import {
  createInvalidResult,
  createValidResult,
  formatPath
} from '../validation-result.js'

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

/**
 * Validates the persisted `vessel` snapshot's shape and presence of its authoritative reference `id`.
 * `vessel` has no separate section PATCH anywhere in the repository (it is resolved once, at draft
 * creation - Step 18) so this is the first dedicated vessel validator; it deliberately checks
 * presence/shape only. Submission-time reference-data currency (is the vessel still active, is the
 * caller still authorised) is Step 32's own separate, asynchronous reference-validity composition
 * (`submission-readiness.js`), never this synchronous structural check.
 *
 * @param {unknown} vessel
 * @returns {{ valid: boolean, issues: ReadonlyArray<object> }}
 */
export function validateVessel(vessel) {
  if (typeof vessel !== 'object' || vessel === null || Array.isArray(vessel)) {
    return createInvalidResult({
      code: VALIDATION_CODES.REQUIRED,
      path: formatPath(['vessel']),
      message: 'A vessel selection is required'
    })
  }

  if (!isNonEmptyString(vessel.id)) {
    return createInvalidResult({
      code: VALIDATION_CODES.REQUIRED,
      path: formatPath(['vessel', 'id']),
      message: 'A vessel id is required'
    })
  }

  return createValidResult()
}
