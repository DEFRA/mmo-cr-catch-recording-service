function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0
}

/**
 * The one small, pure helper implementing historical-snapshot preservation. Not a cache: it never calls
 * the Reference Data Service, never stores anything, and retains nothing beyond its own call - the
 * calling operation (a later step) decides when to invoke it and what to do with the result.
 *
 * When the stable ID is unchanged, the already-trusted stored snapshot is returned untouched (a new,
 * independent copy - never the same object reference) and no fresh resolution is required. When the ID
 * is missing or has changed, the caller must resolve a fresh current snapshot; this helper never guesses
 * a snapshot value itself.
 *
 * @param {{ previousId: unknown, storedSnapshot: object|null, nextId: unknown }} input
 * @returns {{ snapshot: object|null, requiresResolution: boolean }}
 */
export function preserveOrRefresh({ previousId, storedSnapshot, nextId }) {
  const unchanged =
    isNonEmptyString(previousId) &&
    isNonEmptyString(nextId) &&
    previousId === nextId &&
    storedSnapshot !== null &&
    storedSnapshot !== undefined

  if (!unchanged) {
    return { snapshot: null, requiresResolution: true }
  }

  return {
    snapshot: Object.freeze({ ...storedSnapshot }),
    requiresResolution: false
  }
}
