import { createCatchArtifactPort } from './catch-artifact-port.js'
import { createCatchNormalization } from './catch-normalization.js'
import { createCatchPersistencePort } from './catch-persistence-port.js'
import { createCatchQuery } from './catch-query.js'
import { createCatchRecordingController } from './catch-recording-controller.js'
import { createCatchSubmission } from './catch-submission.js'
import { createCatchValidation } from './catch-validation.js'
import { createPdfGeneratorPort } from './pdf-generator-port.js'

// Catch Recording composition root (Step 02 — Catch Recording module boundaries).
//
// Wires the eight approved Catch Recording components following the approved dependency direction from
// design/design/catch-recording-service-design.md §6:
//
//   HTTP adapters (controller)
//       -> application commands and queries (submission, query)
//           -> domain contracts and ports (validation, persistence, artifact, pdfGenerator)
//
// `normalization` is independent and composed at the same level as the ports. Every component may be
// replaced via `overrides` (typically in tests) — an override is used exactly as supplied, by reference,
// and is never copied or mutated. Components not overridden are constructed fresh on every call, so
// repeated calls never share default instances (no global mutable state).
//
// This module performs no infrastructure construction, no Hapi registration, and exposes no public
// route — see docs/adr/0001-catch-recording-module-boundaries.md for the architecture decision.
export function createCatchRecordingModule(overrides = {}) {
  const normalization = overrides.normalization ?? createCatchNormalization()
  const validation = overrides.validation ?? createCatchValidation()
  const persistence = overrides.persistence ?? createCatchPersistencePort()
  const artifact = overrides.artifact ?? createCatchArtifactPort()
  const pdfGenerator = overrides.pdfGenerator ?? createPdfGeneratorPort()

  const submission =
    overrides.submission ??
    createCatchSubmission({ validation, persistence, artifact, pdfGenerator })

  const query = overrides.query ?? createCatchQuery({ persistence, artifact })

  const controller =
    overrides.controller ??
    createCatchRecordingController({ submission, query })

  return Object.freeze({
    controller,
    normalization,
    submission,
    query,
    validation,
    persistence,
    artifact,
    pdfGenerator
  })
}
