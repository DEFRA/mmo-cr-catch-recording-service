// CatchValidation stable validation-code catalogue (Step 07).
//
// This is the minimum approved, non-speculative code set from the Step 07 prompt. Do not add a
// business-specific code for a rule that is not implemented in this step.
export const VALIDATION_CODES = Object.freeze([
  'REQUIRED_FIELD',
  'INVALID_TYPE',
  'INVALID_FORMAT',
  'INVALID_IDENTIFIER',
  'INVALID_DATE',
  'INVALID_TIMESTAMP',
  'INVALID_NUMBER',
  'INVALID_BOOLEAN',
  'INVALID_ENUM_VALUE',
  'EMPTY_VALUE',
  'DUPLICATE_VALUE',
  'DUPLICATE_RELATIONSHIP',
  'COLLECTION_TOO_SMALL',
  'COLLECTION_TOO_LARGE',
  'UNKNOWN_FIELD',
  'PROTECTED_FIELD',
  'CONDITIONAL_FIELD_REQUIRED',
  'CONDITIONAL_FIELD_PROHIBITED',
  'INCONSISTENT_FIELDS'
])

export function isValidationCode(code) {
  return VALIDATION_CODES.includes(code)
}
