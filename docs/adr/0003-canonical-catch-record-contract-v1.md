# 3. Canonical Catch Record Object v1 — structural contract, versioning and draft strategy

Date: 2026-10-03

## Status

Accepted

## Context

Step 02 (ADR 0001) established the Catch Recording module boundaries (`CatchNormalization`,
`CatchValidation`, `CatchSubmission`, `CatchQuery`, ports, and the composition root) but deliberately
defined no business methods, canonical field vocabulary, or domain contracts. Step 05
(`design/github-prompts/step-05-implement-canonical-catch-record-contracts.md`) requires the Canonical
Catch Record Object v1 — the authoritative Catch Recording field vocabulary and hierarchy from
`design/design/catch-recording-service-design.md` §9 — to be implemented for the first time as repository
source. Three choices here are architectural (not merely implementation detail) and are not covered by any
existing ADR:

1. Which runtime mechanism checks the canonical structure.
2. Whether draft (incomplete) and complete (submission-ready) records use one schema or two.
3. How a `v1` contract can be succeeded by a future `v2` without mutating `v1`.

## Decision

**1. Runtime-contract representation: Joi, used standalone.** Joi (`18.2.5`) is already an approved
repository dependency. `src/catch-recording/canonical-catch-record-contract.js` builds one Joi object
schema and calls only `schema.validate(candidate, { abortEarly: false, convert: false })` directly — it
never imports `@hapi/hapi` or `@hapi/boom`, and the schema is never registered as a Hapi route `validate`
key. This keeps the canonical contract framework-neutral while reusing an already-approved, well-understood
library rather than adding a new dependency (for example a JSON Schema validator).

**2. One structural schema, not duplicated draft/complete variants.** Business sections (`vessel`, `trip`,
`pairFishing`, each gear's `characteristics`/`statisticalArea`/`speciesCaught`, `retainedCatch`) are
optional/nullable; `gear` defaults to `[]`. This single schema accepts a legitimate incomplete draft and
will also accept a fully populated record. Step 07 adds submission-readiness (complete-record) rules on top
of this same schema rather than Step 05 duplicating the entire nested hierarchy twice.

**3. Contract versioning via named, suffixed exports.** `CANONICAL_CATCH_RECORD_CONTRACT_VERSION = 'v1'` is
an explicit constant, and the schema/validator exports are suffixed `V1` (`catchRecordSchemaV1`,
`validateCatchRecordStructureV1`). A future `v2` would be added as new exports from a sibling module (for
example `canonical-catch-record-contract-v2.js`); no `v1` export would change. No persisted `schemaVersion`
property is added — the contract-version identity is a source-level constant, not a persisted field, and
remains distinct from the catch-record's own optimistic-concurrency `version` integer (which starts at `1`
per `design/design/catch-recording-service-design.md` §7.3's worked example).

Every Joi object node uses Joi's own default `.unknown(false)`, so an unknown property at any nesting level
fails validation deterministically rather than being silently stripped or accepted.

**Deferred decision, recorded here for traceability:** `retainedCatch.species` is modelled as a plain,
empty-permitted array with **no per-entry field shape**. The approved design
(`design/design/catch-recording-service-design.md` §9.1) defines only an opaque `retainedCatch: {}`
placeholder, and the per-species-entry contract is assigned to Phase 8 (Steps 37-40 in
`design/plans/catch-recording-service-detailed-implementation-plan.md`). `Clarification Resolver` could not
resolve this from approved evidence and returned `USER_DECISION_REQUIRED`; the user explicitly approved
deferring the per-entry shape to Phase 8 rather than inventing fields now.

## Consequences

### Positive

- No new dependency: Joi was already approved and used in the repository for route validation.
- One schema avoids maintaining two parallel, drifting nested hierarchies for draft vs. complete records.
- A future `v2` contract is additive and cannot accidentally break `v1` callers.
- `retainedCatch.species` deferral avoids inventing an unapproved business contract that Phase 8 would
  likely have to redesign.

### Negative / Trade-offs

- Because one schema serves both draft and complete states, it cannot alone enforce submission-readiness
  (for example, "every gear must have exactly one statistical area before submission"); Step 07 must add
  that layer explicitly, and a reviewer must not mistake Step 05's schema for a complete-record validator.
- `retainedCatch.species` entries are completely untyped in v1; Steps 06-08 must not assume any shape for
  them until Phase 8 defines and approves one. This is recorded as an explicit constraint in
  `design/architecture/canonical-catch-record-object-v1.md`.

### Compliance & Governance

- DEFRA Node.js/JavaScript standards: ES modules, named exports, no new dependency.
- Security standards: structural contract rejects unknown properties deterministically (reduces
  mass-assignment/prototype-pollution surface); no real fisher/vessel/skipper data appears in fixtures.
- None — fully compliant. No governance exception required.
