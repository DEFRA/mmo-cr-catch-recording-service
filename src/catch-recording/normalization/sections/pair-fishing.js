import { normaliseTrimmedString } from '../primitives.js'
import { copyField } from '../object-helpers.js'

/**
 * Normalises the client-owned pair-fishing section. The populated `pairVessel`/`pairSkipperName` shape
 * when `enabled` is `true` is not resolved by the approved documents (Step 05), so no structure is
 * assumed for them beyond trimming a string value — whatever the client supplies is preserved as-is for
 * Step 07 to validate. Clearing related values when `enabled` is `false` is not an approved
 * normalisation rule, so it is not performed here.
 *
 * @param {unknown} input
 * @returns {unknown}
 */
export function normalisePairFishing(input) {
  if (input === undefined || input === null) {
    return input
  }

  if (typeof input !== 'object' || Array.isArray(input)) {
    return input
  }

  const output = {}
  copyField(output, input, 'enabled')
  copyField(output, input, 'pairVessel', normaliseTrimmedString)
  copyField(output, input, 'pairSkipperName', normaliseTrimmedString)
  return output
}
