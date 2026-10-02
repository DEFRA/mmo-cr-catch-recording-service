// CatchArtifact port (Step 02 — Catch Recording module boundaries).
//
// Represents the future storage-implementation-neutral boundary for immutable JSON snapshots and PDF
// receipts described in design/design/catch-recording-service-design.md §6.8. No object-storage SDK
// types, bucket configuration, or object-key conventions are defined here — see the later step that
// introduces the first concrete artifact adapter. This port intentionally exposes no methods yet; it is a
// stable, replaceable identity only.
export function createCatchArtifactPort() {
  return Object.freeze({
    name: 'CatchArtifact',
    dependencies: Object.freeze({})
  })
}
