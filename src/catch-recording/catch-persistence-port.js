// CatchPersistence port (Step 02 — Catch Recording module boundaries).
//
// Represents the future infrastructure-neutral persistence boundary described in
// design/design/catch-recording-service-design.md §6.6. No MongoDB types, collection names, indexes, or
// query methods are defined here — see the later step that introduces the first concrete persistence
// adapter. This port intentionally exposes no methods yet; it is a stable, replaceable identity only.
export function createCatchPersistencePort() {
  return Object.freeze({
    name: 'CatchPersistence',
    dependencies: Object.freeze({})
  })
}
