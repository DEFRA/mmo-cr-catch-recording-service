/**
 * The one framework-neutral validation-result contract reused by every CatchValidation scope
 * (structural, section, and complete-validation composition). Never includes HTTP status codes,
 * rejected values, raw input fragments, causes, or internal metadata.
 */

/**
 * Joins canonical path segments (including numeric array indexes) with `.`, mirroring the convention
 * already established by Step 03's safe-detail path representation
 * (`src/common/helpers/errors/sanitise-details.js`).
 *
 * @param {Array<string|number>} segments
 * @returns {string}
 */
export function formatPath(segments) {
  return segments.join('.')
}

function freezeIssue(issue) {
  return Object.freeze({ ...issue })
}

function issueKey(issue) {
  return `${issue.code}|${issue.path}|${issue.message ?? ''}`
}

/**
 * Builds a frozen, deduplicated, deterministically ordered issue list from one or more raw issues or
 * issue arrays, preserving the order issues were first supplied in.
 *
 * @param {...(object|object[])} issuesOrArrays
 * @returns {ReadonlyArray<object>}
 */
function buildIssues(...issuesOrArrays) {
  const seen = new Set()
  const deduped = []

  for (const entry of issuesOrArrays.flat()) {
    const frozen = freezeIssue(entry)
    const key = issueKey(frozen)
    if (!seen.has(key)) {
      seen.add(key)
      deduped.push(frozen)
    }
  }

  return Object.freeze(deduped)
}

/**
 * @returns {{ valid: true, issues: ReadonlyArray<object> }}
 */
export function createValidResult() {
  return Object.freeze({ valid: true, issues: Object.freeze([]) })
}

/**
 * @param {object|object[]} issues - One issue or an array of issues:
 *   `{ code, path, message?, meta? }`.
 * @returns {{ valid: boolean, issues: ReadonlyArray<object> }}
 */
export function createInvalidResult(issues) {
  const builtIssues = buildIssues(issues)
  return Object.freeze({ valid: builtIssues.length === 0, issues: builtIssues })
}

/**
 * Combines multiple validation results (in the order supplied) into one, deduplicating identical
 * issues. The combined result is valid only when every supplied result was valid.
 *
 * @param {...{ valid: boolean, issues: ReadonlyArray<object> }} results
 * @returns {{ valid: boolean, issues: ReadonlyArray<object> }}
 */
export function combineResults(...results) {
  const issues = buildIssues(...results.map((result) => result.issues))
  return Object.freeze({ valid: issues.length === 0, issues })
}
