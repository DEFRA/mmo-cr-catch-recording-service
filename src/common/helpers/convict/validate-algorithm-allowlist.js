/**
 * The approved JWT signing-algorithm allowlist for future Entra token validation (Step 03). `RS256` is
 * the only initially-approved algorithm; `none` and symmetric algorithms (e.g. `HS256`) are explicitly
 * never permitted, matching the approved design's security requirements.
 */
const APPROVED_ALGORITHMS = new Set(['RS256'])

function splitCommaSeparated(value) {
  return String(value)
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
}

export const convictValidateAlgorithmAllowlist = {
  name: 'algorithm-allowlist',
  coerce: function coerceAlgorithmAllowlist(value) {
    return Array.isArray(value) ? value : splitCommaSeparated(value)
  },
  validate: function validateAlgorithmAllowlist(value) {
    if (!Array.isArray(value) || value.length === 0) {
      throw new Error('must be a non-empty array of approved JWT algorithms')
    }

    for (const algorithm of value) {
      if (!APPROVED_ALGORITHMS.has(algorithm)) {
        throw new Error(
          `unsupported JWT algorithm: ${String(algorithm)} (approved: ${[...APPROVED_ALGORITHMS].join(', ')})`
        )
      }
    }
  }
}
