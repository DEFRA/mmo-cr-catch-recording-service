import { createValidationError } from './catch-record-validation-result.js'

// CatchValidation primitive validators (Step 07).
//
// Each function assumes Step 06 has already normalised the candidate's type/shape; these validators add
// context-sensitive requiredness on top of that guarantee and defensively re-confirm representation (in
// case a validator is ever invoked outside the normalise-then-validate pipeline — see
// design/architecture/catch-record-validation-foundation.md §9). None ever throws for invalid input; each
// returns a `ValidationError[]` (empty when valid) and never mutates its input.
const CALENDAR_DATE_PATTERN = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/
const DATE_TIME_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/

function isPresent(value) {
  return value !== null && value !== undefined
}

export function validateRequiredString(
  value,
  path,
  { allowEmpty = false } = {}
) {
  if (!isPresent(value)) {
    return [
      createValidationError('REQUIRED_FIELD', path, 'A value is required.')
    ]
  }

  if (typeof value !== 'string') {
    return [
      createValidationError(
        'INVALID_TYPE',
        path,
        'A string value is required.',
        {
          expectedType: 'string'
        }
      )
    ]
  }

  if (!allowEmpty && value.trim() === '') {
    return [
      createValidationError(
        'EMPTY_VALUE',
        path,
        'A non-empty value is required.'
      )
    ]
  }

  return []
}

export function validateOptionalString(value, path) {
  if (!isPresent(value)) {
    return []
  }

  if (typeof value !== 'string') {
    return [
      createValidationError(
        'INVALID_TYPE',
        path,
        'A string value is required.',
        {
          expectedType: 'string'
        }
      )
    ]
  }

  return []
}

export function validateIdentifier(value, path, options = {}) {
  const errors = options.required
    ? validateRequiredString(value, path)
    : validateOptionalString(value, path)

  return errors.map((error) =>
    error.code === 'INVALID_TYPE'
      ? createValidationError(
          'INVALID_IDENTIFIER',
          path,
          'A valid identifier is required.',
          error.metadata
        )
      : error
  )
}

export function validateBoolean(value, path, { required = false } = {}) {
  if (!isPresent(value)) {
    return required
      ? [createValidationError('REQUIRED_FIELD', path, 'A value is required.')]
      : []
  }

  if (typeof value !== 'boolean') {
    return [
      createValidationError(
        'INVALID_BOOLEAN',
        path,
        'A boolean value is required.'
      )
    ]
  }

  return []
}

export function validateEnum(
  value,
  path,
  allowedValues,
  { required = false } = {}
) {
  if (!isPresent(value)) {
    return required
      ? [createValidationError('REQUIRED_FIELD', path, 'A value is required.')]
      : []
  }

  if (typeof value !== 'string' || !allowedValues.includes(value)) {
    return [
      createValidationError(
        'INVALID_ENUM_VALUE',
        path,
        'The value is not one of the approved options.',
        { allowedValues }
      )
    ]
  }

  return []
}

export function validateCalendarDate(value, path, { required = false } = {}) {
  if (!isPresent(value)) {
    return required
      ? [createValidationError('REQUIRED_FIELD', path, 'A value is required.')]
      : []
  }

  if (typeof value !== 'string' || !CALENDAR_DATE_PATTERN.test(value)) {
    return [
      createValidationError(
        'INVALID_DATE',
        path,
        'A valid YYYY-MM-DD date is required.',
        {
          format: 'YYYY-MM-DD'
        }
      )
    ]
  }

  return []
}

export function validateDateTime(value, path, { required = false } = {}) {
  if (!isPresent(value)) {
    return required
      ? [createValidationError('REQUIRED_FIELD', path, 'A value is required.')]
      : []
  }

  if (typeof value !== 'string' || !DATE_TIME_PATTERN.test(value)) {
    return [
      createValidationError(
        'INVALID_TIMESTAMP',
        path,
        'A valid ISO 8601 UTC-compatible timestamp is required.',
        { format: 'ISO8601' }
      )
    ]
  }

  return []
}

export function validateNumber(
  value,
  path,
  { required = false, positive = false } = {}
) {
  if (!isPresent(value)) {
    return required
      ? [createValidationError('REQUIRED_FIELD', path, 'A value is required.')]
      : []
  }

  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return [
      createValidationError(
        'INVALID_NUMBER',
        path,
        'A finite numeric value is required.'
      )
    ]
  }

  if (positive && value <= 0) {
    return [
      createValidationError(
        'INVALID_NUMBER',
        path,
        'A positive numeric value is required.'
      )
    ]
  }

  return []
}

export function validateCollectionLength(array, path, { min, max } = {}) {
  const errors = []

  if (typeof min === 'number' && array.length < min) {
    errors.push(
      createValidationError(
        'COLLECTION_TOO_SMALL',
        path,
        'The collection does not contain enough entries.',
        { min }
      )
    )
  }

  if (typeof max === 'number' && array.length > max) {
    errors.push(
      createValidationError(
        'COLLECTION_TOO_LARGE',
        path,
        'The collection contains too many entries.',
        { max }
      )
    )
  }

  return errors
}

// Single-pass, Map-based duplicate detection — never quadratic even for large configured collections.
export function findDuplicateKeys(items, keySelector) {
  const seen = new Map()
  const duplicates = new Set()

  for (const item of items) {
    const key = keySelector(item)

    if (key === null || key === undefined) {
      continue
    }

    if (seen.has(key)) {
      duplicates.add(key)
    } else {
      seen.set(key, true)
    }
  }

  return [...duplicates]
}
