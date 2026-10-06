const MAX_STABLE_ID_LENGTH = 100
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTER_PATTERN = /[\x00-\x1f\x7f]/
const DISALLOWED_CHARACTER_PATTERN = /[/\\?#]/

/**
 * Validates a stable reference identifier before it is ever used to construct an outbound request.
 * Deliberately conservative: a non-empty string, bounded length, no path-separator, query, fragment, or
 * control character, and no `..` traversal segment. Framework-neutral, no network call.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export function isValidStableId(value) {
  if (typeof value !== 'string') {
    return false
  }

  if (value.length === 0 || value.length > MAX_STABLE_ID_LENGTH) {
    return false
  }

  if (CONTROL_CHARACTER_PATTERN.test(value)) {
    return false
  }

  if (DISALLOWED_CHARACTER_PATTERN.test(value)) {
    return false
  }

  if (value.includes('..')) {
    return false
  }

  return true
}
