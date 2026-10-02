import { assertRequiredDependency } from './assert-required-dependency.js'

// CatchSubmission boundary (Step 02 — Catch Recording module boundaries).
//
// Represents the future command-oriented application boundary described in
// design/design/catch-recording-service-design.md §6.3 (journey initiation, draft creation, section
// saving, replacement, abandonment, submission, resubmission, edit start). None of those operations are
// implemented here — this boundary only establishes its explicit dependency wiring
// (CatchValidation, CatchPersistence, CatchArtifact, PDFGenerator) per the approved dependency diagram.
export function createCatchSubmission({
  validation,
  persistence,
  artifact,
  pdfGenerator
} = {}) {
  assertRequiredDependency('CatchSubmission', 'validation', validation)
  assertRequiredDependency('CatchSubmission', 'persistence', persistence)
  assertRequiredDependency('CatchSubmission', 'artifact', artifact)
  assertRequiredDependency('CatchSubmission', 'pdfGenerator', pdfGenerator)

  return Object.freeze({
    name: 'CatchSubmission',
    dependencies: Object.freeze({
      validation,
      persistence,
      artifact,
      pdfGenerator
    })
  })
}
