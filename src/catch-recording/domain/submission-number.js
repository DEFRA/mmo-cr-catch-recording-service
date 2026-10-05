/**
 * Pure submission-number calculation. A valid current count is a non-negative safe integer; the next
 * submission number is always `count + 1` (the first successful submission is therefore `1`, from a
 * current count of `0`). Returns `undefined` for any invalid count rather than silently defaulting to
 * `0` or coercing a numeric-looking string.
 *
 * @param {unknown} currentCount
 * @returns {number|undefined}
 */
export function calculateNextSubmissionNumber(currentCount) {
  if (
    typeof currentCount !== 'number' ||
    !Number.isInteger(currentCount) ||
    currentCount < 0 ||
    currentCount > Number.MAX_SAFE_INTEGER
  ) {
    return undefined
  }

  return currentCount + 1
}
