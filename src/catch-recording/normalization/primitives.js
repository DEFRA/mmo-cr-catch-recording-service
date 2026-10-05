/**
 * Approved primitive normalisation for Catch Recording client input.
 *
 * Only whitespace-trimming is approved as a primitive transformation. Nothing else is coerced: a
 * non-string value (including `null`, `undefined`, numbers, booleans, objects, and arrays) is returned
 * unchanged so an invalid or wrongly-typed value remains detectable by Step 07 validation rather than
 * being silently hidden by normalisation.
 */

/**
 * @param {unknown} value
 * @returns {unknown} The trimmed string, or the original value unchanged if it is not a string.
 */
export function normaliseTrimmedString(value) {
  return typeof value === 'string' ? value.trim() : value
}
