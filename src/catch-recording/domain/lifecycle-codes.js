/**
 * Stable lifecycle-policy codes, distinct from Step 07's validation codes (which describe data-shape/
 * business-validation concerns). Reuses the same `{ valid, issues }` result contract
 * (`src/catch-recording/validation/validation-result.js`) rather than inventing a competing shape.
 */
export const LIFECYCLE_CODES = Object.freeze({
  /** The requested transition is not currently eligible from this state. */
  INELIGIBLE_TRANSITION: 'INELIGIBLE_TRANSITION',
  /** The canonical state is internally inconsistent for its persisted status. */
  INCONSISTENT_STATE: 'INCONSISTENT_STATE'
})
