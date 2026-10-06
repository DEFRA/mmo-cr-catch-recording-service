import { VALIDATION_CODES } from '../validation-codes.js'
import {
  createInvalidResult,
  createValidResult,
  formatPath
} from '../validation-result.js'

function issue(code, pathSegments, message) {
  return { code, path: formatPath(pathSegments), message }
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

/**
 * Implements the two approved pair-fishing conditional rules (Step 21 resolves the previously-deferred
 * `enabled: true` direction — `pairVessel`/`pairSkipperName` are plain display strings, not a nested
 * reference-selection shape, confirmed directly from `normalization/sections/pair-fishing.js`):
 *
 * - `enabled: false` → the dependent `pairVessel`/`pairSkipperName` fields must be `null` or absent.
 * - `enabled: true` → both `pairVessel` and `pairSkipperName` are required, non-empty strings.
 *
 * @param {unknown} pairFishing
 * @returns {{ valid: boolean, issues: ReadonlyArray<object> }}
 */
export function validatePairFishing(pairFishing) {
  if (typeof pairFishing !== 'object' || pairFishing === null) {
    return createValidResult()
  }

  if (pairFishing.enabled === false) {
    return validateDisabled(pairFishing)
  }

  if (pairFishing.enabled === true) {
    return validateEnabled(pairFishing)
  }

  return createValidResult()
}

function validateDisabled(pairFishing) {
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

function validateEnabled(pairFishing) {
  const issues = []

  for (const field of ['pairVessel', 'pairSkipperName']) {
    if (!isNonEmptyString(pairFishing[field])) {
      issues.push(
        issue(
          VALIDATION_CODES.REQUIRED,
          ['pairFishing', field],
          'Required when pair fishing is enabled'
        )
      )
    }
  }

  return issues.length === 0 ? createValidResult() : createInvalidResult(issues)
}
