import { normaliseTrimmedString } from '../primitives.js'
import { copyField, normaliseReferenceSelection } from '../object-helpers.js'

/**
 * Normalises the client-owned trip section. Dates use the approved canonical date-only representation
 * as supplied by the client — no reformatting, locale parsing, or timezone conversion is performed
 * (none is approved). Port snapshots are resolved server-side and never accepted from the client.
 *
 * @param {unknown} input
 * @returns {unknown}
 */
export function normaliseTrip(input) {
  if (input === undefined || input === null) {
    return input
  }

  if (typeof input !== 'object' || Array.isArray(input)) {
    return input
  }

  const output = {}
  copyField(output, input, 'startedAndFinishedToday')
  copyField(output, input, 'dateStarted', normaliseTrimmedString)
  copyField(output, input, 'dateEnded', normaliseTrimmedString)
  copyField(output, input, 'departurePort', normaliseReferenceSelection)
  copyField(output, input, 'returnPort', normaliseReferenceSelection)
  return output
}
