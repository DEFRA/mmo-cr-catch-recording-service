import { VALIDATION_CODES } from '../validation-codes.js'
import {
  createInvalidResult,
  createValidResult,
  formatPath
} from '../validation-result.js'

function issue(code, pathSegments, message) {
  return { code, path: formatPath(pathSegments), message }
}

/**
 * Implements the one approved pair-fishing conditional rule: when `enabled` is `false`, the dependent
 * `pairVessel`/`pairSkipperName` fields must be `null` or absent. The reverse direction ("`enabled` is
 * `true` requires certain fields") is not implemented — the populated pair-vessel shape remains
 * unresolved (Step 05), so there is nothing approved to validate against yet.
 *
 * @param {unknown} pairFishing
 * @returns {{ valid: boolean, issues: ReadonlyArray<object> }}
 */
export function validatePairFishing(pairFishing) {
  if (typeof pairFishing !== 'object' || pairFishing === null) {
    return createValidResult()
  }

  if (pairFishing.enabled !== false) {
    return createValidResult()
  }

  const issues = []

  for (const field of ['pairVessel', 'pairSkipperName']) {
    const value = pairFishing[field]
    if (value !== null && value !== undefined) {
      issues.push(
        issue(
          VALIDATION_CODES.CONDITIONAL_FIELD_INCONSISTENT,
          ['pairFishing', field],
          'Must be null or absent when pair fishing is disabled'
        )
      )
    }
  }

  return issues.length === 0 ? createValidResult() : createInvalidResult(issues)
}
