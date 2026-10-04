import { isValidationCode } from './catch-record-validation-codes.js'

// CatchValidation validation-result and error contract, plus canonical field-path helpers (Step 07).
//
// A validation error is `{ code, path, message, metadata }`, matching the field names already allow-listed
// by src/common/helpers/errors/safe-details.js, so a later HTTP-layer adapter can pass one of these
// straight into buildSafeDetails without renaming anything. `metadata` is optional and must never contain
// a full rejected value or personal data.
export function createValidationError(code, path, message, metadata) {
  if (!isValidationCode(code)) {
    throw new Error(`Unsupported validation code: "${code}"`)
  }

  const error = { code, path, message }

  if (metadata !== undefined) {
    error.metadata = Object.freeze({ ...metadata })
  }

  return Object.freeze(error)
}

// A validation result is always `{ isValid, errors }`; `errors` is always a plain array (never
// `undefined`), empty when `isValid` is `true`.
export function createValidationResult(errors = []) {
  return Object.freeze({
    isValid: errors.length === 0,
    errors: Object.freeze([...errors])
  })
}

// Deterministically merges multiple validation results in call order — never by iterating an untrusted
// object's own keys.
export function combineValidationResults(...results) {
  const errors = results.flatMap((result) => result.errors)

  return createValidationResult(errors)
}

export function joinPath(base, segment) {
  if (!base) {
    return segment
  }

  return `${base}.${segment}`
}

export function indexPath(base, index) {
  return `${base}[${index}]`
}
