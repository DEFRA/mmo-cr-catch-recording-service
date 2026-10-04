import { ApplicationError } from '#/common/helpers/errors/application-error.js'

// CatchNormalization primitive normalisers (Step 06).
//
// Each function either returns a normalised value or throws a deterministic `ApplicationError`
// (`INVALID_REQUEST`, Step 03). None applies JavaScript truthiness, system locale, system timezone, or
// unapproved coercion — every rejection is an explicit, enumerated rule, never an inferred one.
const CALENDAR_DATE_PATTERN = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/
const DATE_TIME_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/
const YES_NO_VALUES = Object.freeze(['YES', 'NO'])

function invalidPrimitive(code, message) {
  throw new ApplicationError('INVALID_REQUEST', message, { code })
}

// Shared by normalizeText and normalizeIdentifier: both are trimmed strings whose only difference is
// semantic (free text vs. a reference identifier), not representational.
function normalizeTrimmedString(value, { nullable, code }) {
  if (value === null || value === undefined) {
    if (nullable) {
      return null
    }

    invalidPrimitive(code, 'A required text value was missing.')
  }

  if (typeof value !== 'string') {
    invalidPrimitive(code, 'A text value must be a string.')
  }

  const trimmed = value.trim()

  if (trimmed === '') {
    if (nullable) {
      return null
    }

    invalidPrimitive(code, 'A required text value must not be empty.')
  }

  return trimmed
}

export function normalizeText(value, { nullable = true } = {}) {
  return normalizeTrimmedString(value, { nullable, code: 'INVALID_TEXT_VALUE' })
}

export function normalizeIdentifier(value, { nullable = true } = {}) {
  return normalizeTrimmedString(value, {
    nullable,
    code: 'INVALID_IDENTIFIER_VALUE'
  })
}

export function normalizeCalendarDate(value, { nullable = true } = {}) {
  if (value === null || value === undefined) {
    if (nullable) {
      return null
    }

    invalidPrimitive(
      'INVALID_DATE_VALUE',
      'A required calendar date was missing.'
    )
  }

  if (typeof value !== 'string') {
    invalidPrimitive('INVALID_DATE_VALUE', 'A calendar date must be a string.')
  }

  const trimmed = value.trim()

  if (!CALENDAR_DATE_PATTERN.test(trimmed)) {
    invalidPrimitive(
      'INVALID_DATE_VALUE',
      'A calendar date must use the YYYY-MM-DD representation.'
    )
  }

  return trimmed
}

export function normalizeDateTime(value, { nullable = true } = {}) {
  if (value === null || value === undefined) {
    if (nullable) {
      return null
    }

    invalidPrimitive(
      'INVALID_DATE_TIME_VALUE',
      'A required date-time value was missing.'
    )
  }

  if (typeof value !== 'string') {
    invalidPrimitive(
      'INVALID_DATE_TIME_VALUE',
      'A date-time value must be a string.'
    )
  }

  const trimmed = value.trim()

  if (!DATE_TIME_PATTERN.test(trimmed)) {
    invalidPrimitive(
      'INVALID_DATE_TIME_VALUE',
      'A date-time value must use an ISO 8601 UTC-compatible representation.'
    )
  }

  return trimmed
}

export function normalizeBoolean(value, { nullable = true } = {}) {
  if (value === null || value === undefined) {
    if (nullable) {
      return null
    }

    invalidPrimitive(
      'INVALID_BOOLEAN_VALUE',
      'A required boolean value was missing.'
    )
  }

  if (typeof value !== 'boolean') {
    invalidPrimitive(
      'INVALID_BOOLEAN_VALUE',
      'A boolean value must be exactly true or false.'
    )
  }

  return value
}

export function normalizePositiveNumber(value, { nullable = true } = {}) {
  if (value === null || value === undefined) {
    if (nullable) {
      return null
    }

    invalidPrimitive(
      'INVALID_NUMBER_VALUE',
      'A required numeric value was missing.'
    )
  }

  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    invalidPrimitive(
      'INVALID_NUMBER_VALUE',
      'A numeric value must be a positive, finite number.'
    )
  }

  return value
}

export function normalizeYesNo(value, { nullable = true } = {}) {
  if (value === null || value === undefined) {
    if (nullable) {
      return null
    }

    invalidPrimitive(
      'INVALID_YES_NO_VALUE',
      'A required Yes/No value was missing.'
    )
  }

  if (typeof value !== 'string' || !YES_NO_VALUES.includes(value)) {
    invalidPrimitive(
      'INVALID_YES_NO_VALUE',
      'A Yes/No value must be exactly "YES" or "NO".'
    )
  }

  return value
}
