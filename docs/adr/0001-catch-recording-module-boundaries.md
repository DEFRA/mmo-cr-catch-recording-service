# 1. Establish Catch Recording internal component boundaries and composition

Date: 2026-10-02

## Status

Accepted

## Context

The Catch Recording Service repository currently contains only a minimal Hapi backend skeleton (health
check, an example route/service pair, MongoDB connection plugin) and no Catch Recording domain code. The
approved service design (`design/design/catch-recording-service-design.md`) defines eight logical
components — CatchRecording Controller, CatchNormalization, CatchSubmission, CatchQuery,
CatchValidation, CatchPersistence, CatchArtifact and PDFGenerator — with an approved dependency direction
(HTTP adapters → application commands/queries → domain contracts/ports ← infrastructure adapters).

Step 02 of the approved detailed implementation plan requires establishing minimal, repository-aligned
internal boundaries for these eight components and a composition mechanism, without implementing business
behaviour, persistence, external integration, authentication, artifact storage or PDF generation, and
without registering any public route.

Constraints considered:

- DEFRA/GDS standards precedence (DEFRA > GDS > community) and the repository's own
  `.github/instructions/nodejs-hapi-api.instructions.md` (ES modules, named exports, thin handlers,
  framework-agnostic services).
- The repository has no existing multi-layer domain structure to extend — only `src/routes/`,
  `src/services/`, `src/plugins/` and `src/common/helpers/` exist, none of which represent a bounded,
  multi-component domain area.
- No new runtime dependency may be introduced.
- No concrete adapter (MongoDB, S3-compatible storage, PDF library) may be selected or implemented yet.

### Alternatives considered

1. **Nest the new modules under `src/services/`** (e.g. `src/services/catch-recording/...`). Rejected:
   `src/services/` is documented and used as the location for simple, framework-agnostic IO helpers (see
   `src/services/ExampleFind.js`), not for a multi-layer bounded context containing an HTTP-adapter-shaped
   component (Controller) alongside application and port components. Reusing it as-is would blur that
   existing convention rather than extend it cleanly.
2. **A class-based dependency-injection container or named service registry** (e.g. a `register(name,
factory)` / `resolve(name)` container). Rejected: the Step 02 prompt explicitly prohibits introducing a
   competing "service registry" or "port system", and a registry resolved by string name would require
   "unrestricted property access for component selection", which is also explicitly disallowed.
3. **Represent the Controller as an unregistered route-shaped module under `src/routes/`.** Rejected:
   `src/routes/` is documented and used exclusively for modules exporting actual Hapi route objects
   (`method`/`path`/`handler`) that are registered in `src/plugins/router.js`. An unregistered, non-route
   shaped module placed there would be misleading to future readers and risks accidental registration.

## Decision

Establish the eight Catch Recording components as plain ES module factories under a new, dedicated
directory, `src/catch-recording/`, composed by a single explicit factory function,
`createCatchRecordingModule(overrides)`, in `src/catch-recording/catch-recording-composition.js`.

Details:

- Each component is a named factory (e.g. `createCatchSubmission`, `createCatchRecordingController`)
  returning `Object.freeze({ name, dependencies })`. Components with required collaborators (Controller,
  CatchSubmission, CatchQuery) validate their presence via a small shared helper
  (`assertRequiredDependency`) and throw a deterministic `Error` if one is missing. Components with no
  collaborators yet (CatchNormalization, CatchValidation, CatchPersistence, CatchArtifact, PDFGenerator)
  take no arguments.
- No business methods are defined on any component in this step — only identity (`name`) and explicit
  dependency wiring. This keeps the contracts minimal rather than speculative, per the approved scope, and
  defers method-signature decisions to the step that first implements each component's behaviour.
- `createCatchRecordingModule(overrides = {})` wires the dependency graph from the design's component
  diagram: `persistence`, `artifact`, `pdfGenerator` and `validation` are independent leaves;
  `normalization` is independent; `submission` depends on `validation`, `persistence`, `artifact`,
  `pdfGenerator`; `query` depends on `persistence`, `artifact`; `controller` depends on `submission`,
  `query`. Any of the eight keys may be overridden by a caller (typically a test) and the override is
  passed through by reference, never copied or mutated.
- This follows the repository's existing plugin-object and named-factory conventions (ES modules, named
  exports, colocated `*.test.js`) rather than introducing a new composition paradigm.
- No component is registered with Hapi. `src/plugins/router.js` and `src/server.js` are unchanged.

This ADR covers only the internal boundary and composition decision. It does not approve any persistence
technology, object-storage/PDF library, authentication mechanism, or external-integration approach — those
remain open decisions for the steps that introduce them.

## Consequences

### Positive

- Each of the eight approved components has a single, unambiguous, discoverable location and a stable
  identity (`name`) that later steps can extend in place.
- The dependency direction from the design document is enforced structurally (a component cannot be
  constructed without its declared collaborators), catching a wiring mistake immediately and
  deterministically rather than silently.
- Full test substitutability is available from day one: any component can be replaced with a test double
  by passing an override to `createCatchRecordingModule`, with no mocking framework or registry needed.
- No HTTP, MongoDB, object-storage or PDF library types can leak into these contracts, because no such
  import exists in any of the new files — verified by an automated static check (see the architecture
  document, §8).

### Negative / Trade-offs

- A new top-level `src/catch-recording/` directory is introduced, growing the repository's structural
  surface beyond the current four source directories. Mitigated by keeping every file flat, small, and
  following existing naming/export/test conventions exactly, and by documenting the directory's purpose in
  `design/architecture/catch-recording-module-boundaries.md`.
- Components currently expose no behaviour (methods), which means this step delivers structure only, not
  working functionality. This is intentional and matches the approved Step 02 scope; later steps add
  methods to the existing factories rather than replacing them.

### Compliance & Governance

- DEFRA standard(s) referenced: DEFRA Node.js standards (ES modules, named exports), DEFRA Secure by
  Design (no infrastructure/credentials introduced, no public surface added).
- Any governance exception required: None — fully compliant. No architecture decision beyond the internal
  boundary/composition is made here.
