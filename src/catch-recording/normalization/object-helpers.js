import { normaliseTrimmedString } from './primitives.js'

/**
 * Copies `key` from `source` onto `target` only when `source` actually owns that key (preserving the
 * distinction between "absent" and "explicitly `null`"/"explicitly `undefined`"), applying an optional
 * transform. This is the one mechanism every section normaliser uses to build output by explicit
 * allow-listing — a key never present in the relevant normaliser's calls to this helper can never reach
 * output, regardless of what the caller supplied.
 *
 * @param {object} target
 * @param {unknown} source
 * @param {string} key
 * @param {(value: unknown) => unknown} [transform]
 */
export function copyField(target, source, key, transform = (value) => value) {
  if (
    source !== null &&
    typeof source === 'object' &&
    Object.hasOwn(source, key)
  ) {
    target[key] = transform(source[key])
  }
}

/**
 * Normalises the common "stable reference selection" shape used throughout the canonical contract for
 * client-owned selections (`vessel`, `departurePort`, `returnPort`, `gear`, `statisticalArea`,
 * `species`): only the stable `id` is client-owned input. Any `*Snapshot` field a client supplies is
 * never copied — snapshots are resolved server-side only (canonical doc §4.5) — because it is simply
 * not on this allow-list.
 *
 * @param {unknown} input
 * @returns {unknown}
 */
export function normaliseReferenceSelection(input) {
  if (input === undefined || input === null) {
    return input
  }

  if (typeof input !== 'object' || Array.isArray(input)) {
    // Malformed shape: pass through unchanged so Step 07 can detect the invalidity.
    return input
  }

  const output = {}
  copyField(output, input, 'id', normaliseTrimmedString)
  return output
}

/**
 * Normalises an array field by mapping each entry through `normaliseEntry`. If `input` is not an array,
 * it is returned unchanged rather than coerced to `[]`, so a malformed collection remains detectable
 * rather than silently hidden.
 *
 * @param {unknown} input
 * @param {(entry: unknown) => unknown} normaliseEntry
 * @returns {unknown}
 */
export function normaliseArray(input, normaliseEntry) {
  if (input === undefined || input === null) {
    return input
  }

  if (!Array.isArray(input)) {
    return input
  }

  return input.map((entry) => normaliseEntry(entry))
}
