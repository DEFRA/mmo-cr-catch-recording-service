import { assertRequiredDependency } from './assert-required-dependency.js'

// CatchRecording Controller boundary (Step 02 — Catch Recording module boundaries).
//
// Represents the future inbound HTTP adapter described in
// design/design/catch-recording-service-design.md §6.1. This boundary is intentionally NOT registered as
// a Hapi route (see src/plugins/router.js, which is unchanged by this step) and contains no request or
// response mapping, no Hapi types, and no business logic. It only establishes explicit dependency wiring
// to the future command (CatchSubmission) and query (CatchQuery) application boundaries, per the
// approved dependency direction: HTTP adapters -> application commands and queries.
export function createCatchRecordingController({ submission, query } = {}) {
  assertRequiredDependency('CatchRecordingController', 'submission', submission)
  assertRequiredDependency('CatchRecordingController', 'query', query)

  return Object.freeze({
    name: 'CatchRecordingController',
    dependencies: Object.freeze({
      submission,
      query
    })
  })
}
