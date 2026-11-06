const MAX_SAFE_SECONDS = Number.MAX_SAFE_INTEGER

/**
 * A positive (`>= 1`), finite, non-fractional duration in seconds, bounded to reject overflow values.
 * Used by `authorization.roleCacheTtlSeconds` and `authorization.roleCacheMaximumStaleSeconds` — zero,
 * negative, fractional, non-numeric, and overflow values are all rejected.
 */
export const convictValidatePositiveIntegerSeconds = {
  name: 'positive-integer-seconds',
  coerce: function coercePositiveIntegerSeconds(value) {
    return typeof value === 'string' ? Number(value) : value
  },
  validate: function validatePositiveIntegerSeconds(value) {
    if (
      typeof value !== 'number' ||
      !Number.isInteger(value) ||
      value < 1 ||
      value > MAX_SAFE_SECONDS
    ) {
      throw new Error(
        `must be a positive integer number of seconds (1 to ${MAX_SAFE_SECONDS})`
      )
    }
  }
}
