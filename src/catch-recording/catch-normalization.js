// CatchNormalization boundary (Step 02 — Catch Recording module boundaries).
//
// Represents the future canonical input-conversion responsibility described in
// design/design/catch-recording-service-design.md §6.2. No normalisation rules, field mapping or
// Canonical Catch Record Object shape are defined here — see Step 05/06 of the approved implementation
// plan. This boundary intentionally exposes no methods yet; it is a stable, composable identity only.
export function createCatchNormalization() {
  return Object.freeze({
    name: 'CatchNormalization',
    dependencies: Object.freeze({})
  })
}
