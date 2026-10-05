/**
 * The approved, focused, cross-domain stable validation-code catalogue for CatchValidation.
 *
 * A focused set of reusable codes is preferred over one code per field. No code exists for a rule that
 * is not implemented (e.g. no collection-limit code, because no collection limit is approved/configured
 * — see `docs/configuration-decisions.md`).
 */
export const VALIDATION_CODES = Object.freeze({
  /** Explicitly approved required data is missing. */
  REQUIRED: 'REQUIRED',
  /** A value's structural shape (type/container) is invalid. */
  INVALID_STRUCTURE: 'INVALID_STRUCTURE',
  /** A value is not one of the approved supported values (e.g. an unsupported persisted status). */
  UNSUPPORTED_VALUE: 'UNSUPPORTED_VALUE',
  /** A relationship that must be unique within its scope is duplicated. */
  DUPLICATE_RELATIONSHIP: 'DUPLICATE_RELATIONSHIP',
  /** An internal reference does not resolve to an existing association in the same Catch Record. */
  INVALID_REFERENCE: 'INVALID_REFERENCE',
  /** An approved conditional rule's dependent fields are inconsistent with their condition. */
  CONDITIONAL_FIELD_INCONSISTENT: 'CONDITIONAL_FIELD_INCONSISTENT'
})
