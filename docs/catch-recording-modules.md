# Catch Recording Module Boundaries

> Produced by Phase 1, Step 02
> (`design/github-prompts/step-02-establish-catch-recording-module-boundaries.md`). Establishes ownership
> of the eight approved Catch Recording modules. This document does not duplicate the full service
> design (`design/architecture/catch-recording-service-design.md`) or implementation plan
> (`design/plans/catch-recording-service-detailed-implementation-plan.md`) — see those for complete
> detail; this is the focused, current-state ownership reference.

## Status

Greenfield: this is a new Catch Recording domain implementation built on the repository's generic
Node.js/Hapi service skeleton (see [`docs/repository-context.md`](./repository-context.md)). No module
listed below has any executable code yet — ownership is established here so later phases build in the
agreed location, not invented ad hoc.

None of these modules may reference a previous Catch Recording implementation, legacy fields, migration
or compatibility behaviour, Redis, or any other application-cache technology. The approved architecture
has no application cache.

## Ownership root

`src/catch-recording/` (see [`src/catch-recording/README.md`](../src/catch-recording/README.md)).

A module subdirectory is created only when the implementation step that owns it adds its first real file.
No subdirectory exists yet — creating one now, with no content, would be an empty architecture layer,
which is explicitly disallowed.

## The eight modules

### 1. CatchRecording Controller

Owns the inbound HTTP adapter boundary: Hapi routes, Joi transport validation, trusted request-context
extraction, mapping approved application results to HTTP responses.

**Excluded:** direct MongoDB or object-storage access, PDF generation, lifecycle decisions, business
rules, per-route error translation (error mapping is the single central Hapi boundary owned by Step 03).

### 2. CatchNormalization

Owns deterministic conversion of approved inbound data into canonical input: primitive, section and
complete-object normalisation; unknown-field handling; protection of server-owned fields; deep input
immutability.

**Excluded:** legacy representations, compatibility aliases, migrations, fallback document formats.

### 3. CatchSubmission

Owns write-oriented Catch Record use cases and coordination: draft creation, section saves, mobile
complete replacement, abandonment, submission, resubmission, completion, starting an in-place amendment;
coordinates validation, persistence, history, artifacts and PDF generation; enforces lifecycle policy,
expected version and targeted idempotency.

**Excluded:** a generic transaction framework or separate durable submission-operation state machine
(deterministic artifact keys and targeted idempotency are used first).

### 4. CatchQuery

Owns read-oriented Catch Record use cases: owner-scoped listing, complete retrieval, derived display
status, domain progress and submission eligibility, history retrieval, submission-version listing,
authorised artifact retrieval.

**Excluded:** UI navigation data, a broad administrative read platform.

### 5. CatchValidation

Owns reusable Catch Recording domain validation below the HTTP layer: structural, section, complete-record
validation; duplicate-relationship detection; per-gear completeness; cross-section consistency; collection
limits; conditional validation; lifecycle eligibility where delegated; reference validity when composed
with the reference-data boundary. Shared by section saves, complete replacement, submission and
resubmission. Does not depend on Hapi — Joi remains responsible for transport validation only.

**Excluded:** a standalone section-validation HTTP endpoint.

### 6. CatchPersistence

Owns MongoDB-specific Catch Recording access: creation and owner-safe retrieval, retrieval by internal ID
and friendly reference, atomic update primitives and explicit update mapping, atomic expected-version
matching with version increment, targeted list-query primitives, append-only history persistence and
retrieval, targeted idempotency-record persistence, vessel-profile persistence (favourites/skippers),
index creation.

**Excluded:** a generic repository framework. No other module accesses MongoDB collection APIs or
document types directly.

### 7. CatchArtifact

Owns immutable submission artifact storage: canonical JSON snapshots and generated PDF receipts via
server-generated deterministic object keys; verifies successful writes; returns artifact metadata;
retrieves an artifact by Catch Record, submission number and approved type; prevents accidental
replacement of a committed historical artifact.

### 8. PDFGenerator

Accepts an immutable canonical submission snapshot and produces the version-specific receipt: generates
content only from the supplied snapshot, includes the approved Catch Record/vessel/trip/gear/area/
species/landing/submission/status information, returns PDF content and generation metadata, applies
content-size and rendering-safety controls.

**Excluded:** loading mutable database state or unapproved remote content during generation.

## Approved dependency direction

```text
HTTP adapters -> application and domain modules -> ports -> infrastructure adapters
```

- HTTP concerns belong at the controller boundary only.
- Application and domain code (`normalization/`, `submission/`, `query/`, `validation/`) must not import
  Hapi, `@hapi/boom`, the `mongodb` driver, or an object-storage SDK.
- MongoDB-specific behaviour belongs to `persistence/` only.
- Object-storage SDK behaviour belongs to `artifact/` only.
- PDF rendering belongs to `pdf/` only.
- Business validation belongs to `validation/`, not route schemas (route schemas validate transport
  shape only).

## Rules for adding future files

- Create a module subdirectory only when its first real implementation file is added.
- A small module may be one implementation file plus one colocated test; split further only when the
  module has enough code to justify it.
- Do not create an empty directory, placeholder file, TODO-only file, pass-through wrapper, barrel file
  for an empty module, fake interface, generic base class, registry, or service locator.
- Do not move existing generic infrastructure (`src/plugins/`, `src/common/helpers/`) into this tree
  solely to make the layout look complete.

## Relationship to later steps

This document fixes ownership and boundaries only. Step 03 adds the shared `ApplicationError` model and
central HTTP error mapping; Step 04 adds the configuration contracts the plan currently requires; Phase 2
onward adds the first real executable code inside these boundaries (canonical object, normalisation,
validation, lifecycle policy, and so on), each under the module listed above that owns it.
