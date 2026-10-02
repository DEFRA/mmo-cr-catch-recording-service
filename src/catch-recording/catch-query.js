import { assertRequiredDependency } from './assert-required-dependency.js'

// CatchQuery boundary (Step 02 — Catch Recording module boundaries).
//
// Represents the future read-oriented application boundary described in
// design/design/catch-recording-service-design.md §6.4 (listing, retrieval, journey progress, history,
// audit metadata, artifact metadata, administrative read models). None of those operations are
// implemented here — this boundary only establishes its explicit dependency wiring
// (CatchPersistence, CatchArtifact) per the approved dependency diagram. CatchQuery remains a separate
// module from CatchSubmission and has no dependency on it.
export function createCatchQuery({ persistence, artifact } = {}) {
  assertRequiredDependency('CatchQuery', 'persistence', persistence)
  assertRequiredDependency('CatchQuery', 'artifact', artifact)

  return Object.freeze({
    name: 'CatchQuery',
    dependencies: Object.freeze({
      persistence,
      artifact
    })
  })
}
