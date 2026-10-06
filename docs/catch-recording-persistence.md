# Catch Record Persistence

> Produced by Phase 3, Step 09
> (`design/github-prompts/step-09-implement-catch-record-persistence.md`;
> saved plan: `design/github-prompts/Step 09-implement-catch-record-persistence-plan.md`), extended by
> Step 11 (`design/github-prompts/step-11-implement-optimistic-concurrency.md`; saved plan:
> `design/github-prompts/Step 11-implement-optimistic-concurrency-plan.md`) with the expected-version
> contract and atomic compare-and-update described below. This is a focused reference — see
> [`canonical-catch-record.md`](./canonical-catch-record.md) for the canonical contract this module
> round-trips, and [`error-handling.md`](./error-handling.md) for the shared `ApplicationError` contract
> it reuses.

## Purpose and ownership

`CatchPersistence` (`src/catch-recording/persistence/`) is the **sole Catch Recording owner of Catch
Record MongoDB access**. No other module under `src/catch-recording/` imports the `mongodb` driver or
touches the Catch Record collection directly (verified by `architecture-boundary.test.js`). It owns:
collection access, explicit canonical ⇄ document mapping, creation, owner-scoped retrieval by ID, trusted
internal retrieval by friendly reference, one existing-record atomic compare-and-update primitive (with
optimistic concurrency), a bounded/deterministic owner-scoped list primitive, required indexes, and
translating every MongoDB failure into the shared framework-neutral `ApplicationError`
(`src/common/helpers/errors/`) — never a raw MongoDB error, and never Hapi/Boom (this module has no HTTP
awareness).

| File                          | Responsibility                                                                                                                                 |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `catch-record-collection.js`  | `CATCH_RECORD_COLLECTION` constant; `getCatchRecordCollection(db)`; `ensureCatchRecordIndexes(db)`                                             |
| `catch-record-mapper.js`      | `toPersistenceDocument(catchRecord)`; `toCanonicalRecord(document)`                                                                            |
| `persistence-guards.js`       | `assertPlainString`, `assertSafeListLimit`, `assertAllowedChanges` — the shared injection/allow-list guard                                     |
| `expected-version.js`         | Framework-neutral expected-version contract: `MIN_EXPECTED_VERSION`, `validateExpectedVersion(value)`                                          |
| `catch-persistence-errors.js` | `translateInsertError`, `malformedDocumentError`, `unexpectedPersistenceError`, `versionConflictError`                                         |
| `catch-persistence.js`        | Public operations (below); re-exports `ensureCatchRecordIndexes`, `CATCH_RECORD_COLLECTION`, `MIN_EXPECTED_VERSION`, `validateExpectedVersion` |

## Collection name

`catch-records` — a persistence-owned source constant, not convict configuration
(`docs/configuration-decisions.md` confirms Catch Record collection names are resolved by the owning
module, not Step 04). Directly justified by the approved resource naming already used throughout
`design/plans/catch-recording-service-implementation-phases-plan.md` (`POST /v1/catch-records`,
`GET /v1/catch-records/{id}`, ...) and matches the existing plugin's kebab-case convention (`'mongo-locks'`,
`'example-data'` in `src/plugins/mongodb.js`).

## Identifier representation

The canonical `id` (a server-generated UUID string, already created by a later trusted application
operation — `CatchPersistence` never generates it) is stored directly as MongoDB's `_id`. This is an
explicit, tested mapping (`catch-record-mapper.test.js`), not an implicit leak: MongoDB's own automatic
unique index on `_id` already satisfies "unique canonical internal ID" with no redundant manual index,
and a duplicate internal ID fails deterministically via that existing uniqueness guarantee.

## Canonical ⇄ persistence mapping

Both `toPersistenceDocument` and `toCanonicalRecord` assign every one of the Step 05 canonical contract's
22 root fields explicitly by name — never an object spread of either the canonical input or the raw
stored document. Nested structures (`vessel`, `trip`, `pairFishing`, `gears`, `speciesNotLanded`,
`artifacts`) are deep-cloned (`structuredClone`) in both directions, so neither mapping shares a mutable
reference with its input, and the caller's own object is never mutated.

`toCanonicalRecord` fails safely (throws, translated by the caller into `malformedDocumentError` —
`UNEXPECTED_INTERNAL_FAILURE`/`MALFORMED_CATCH_RECORD_DOCUMENT`, never exposing the stored document) when
the document is not an object, `schemaVersion` is unsupported (no fallback, no migration-on-read), `_id`/
`catchRecordReference`/`ownerUserId` are not non-empty strings, `status` is not one of the three persisted
statuses (`isPersistedStatus`, reused from Step 08's `lifecycle-status.js`), or `gears` is not an array.
This is a structural safety check only — not a re-run of Step 07 business validation.

## Operations

- **`createCatchRecord(db, catchRecord)`** — maps and `insertOne`s exactly one document; returns an
  independent mapped copy; never generates an ID/reference/status/version/timestamp/actor. Duplicate
  `_id` or duplicate `catchRecordReference` (MongoDB `11000`) is distinguished by the driver's
  `keyPattern` and translated to `DUPLICATE_RESOURCE` (`DUPLICATE_CATCH_RECORD_ID` /
  `DUPLICATE_CATCH_RECORD_REFERENCE`); any other failure becomes `unexpectedPersistenceError`.
- **`findCatchRecordByIdForOwner(db, { id, ownerUserId })`** — ownership is part of the MongoDB filter
  itself (`{ _id: id, ownerUserId }`), never a post-query comparison. Returns the mapped canonical record
  or `null`. A different owner with the same `id`, and a wholly absent `id`, both return the same `null`
  — no distinguishing behaviour, no disclosure.
- **`findCatchRecordByReference(db, { catchRecordReference })`** — **trusted-internal, not owner-scoped.**
  Exact match only (no regex/prefix/case-insensitive search). Exists only for a future trusted application
  operation that needs to check reference existence/uniqueness (for example Step 17's friendly-reference
  generation). **Must never be exposed directly to an HTTP route** without an owner-scoping wrapper being
  added by a later approved contract — no approved document currently requires a public/owner-scoped
  reference lookup.
- **`applyAuditMetadataUpdate(db, { id, ownerUserId, expectedVersion, changes })`** — the one
  existing-record atomic compare-and-update primitive, extended by Step 11 with optimistic concurrency
  (see [Optimistic concurrency](#optimistic-concurrency) below). `changes` may only contain
  `updatedAt`/`updatedBy` (both plain strings); any other key (including `version`, `status`, or any
  business field) throws a `TypeError` before any Mongo call is made. Uses one atomic
  `findOneAndUpdate({ _id: id, ownerUserId, version: expectedVersion }, { $set: changes, $inc: { version:
1 } }, { returnDocument: 'after' })`; returns the updated canonical record (with `version` incremented
  by exactly `1`), `null` when the record does not exist for this owner, or throws a deterministic
  `VERSION_CONFLICT` `ApplicationError` when the owner-scoped record exists but `expectedVersion` no
  longer matches. Does not touch history or section data — a future section-update primitive is expected
  to reuse the same atomic predicate shape rather than add a competing update path.
- **`listCatchRecordsByOwner(db, { ownerUserId, limit })`** — filters by `ownerUserId` only (no status/
  vessel filter, cursor, or offset — none is approved yet), sorted `{ createdAt: -1, _id: 1 }`
  (deterministic: newest first, stable tie-breaker), bounded by a caller-supplied `limit` that must be an
  integer in `(0, MAX_LIST_LIMIT]`. `MAX_LIST_LIMIT` (100) is a **persistence-owned technical safety
  ceiling, not a business page size** — `docs/configuration-decisions.md` explicitly defers a final
  collection/payload-limit decision; this ceiling exists only so a future caller defect can never produce
  an unbounded query.
- **`ensureCatchRecordIndexes(db)`** — idempotent; safe to call on every server start. Wired into the
  existing `src/plugins/mongodb.js` `createIndexes(db)` function (one integration point, no second Mongo
  client).

## Required indexes

| Index                                       | Justification                                                                                                                                                       |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `_id` (MongoDB automatic, unique)           | Unique canonical internal ID; backs `findCatchRecordByIdForOwner` and `applyAuditMetadataUpdate`'s `_id` equality match. Not created manually — would be redundant. |
| `{ catchRecordReference: 1 }`, unique       | Enforces the unique friendly reference; backs `findCatchRecordByReference`'s exact-match query.                                                                     |
| `{ ownerUserId: 1, createdAt: -1, _id: 1 }` | Backs `listCatchRecordsByOwner`'s exact filter + sort + tie-breaker shape, avoiding an in-memory sort.                                                              |

No text, wildcard, TTL, history, idempotency, submission-operation, migration, or cache-related index
exists, and no index backs a query shape Step 09 does not implement. Step 11's expected-version predicate
adds `version` as a third equality term on an already-`_id`-scoped point lookup — it does not change the
access pattern, so no additional index was added (see `design/github-prompts/Step 11-implement-
optimistic-concurrency-plan.md` §"Resolved decisions" for the evidence).

## Optimistic concurrency

> Produced by Phase 3, Step 11
> (`design/github-prompts/step-11-implement-optimistic-concurrency.md`; saved plan:
> `design/github-prompts/Step 11-implement-optimistic-concurrency-plan.md`).

`src/catch-recording/persistence/expected-version.js` is the framework-neutral expected-version contract:
`MIN_EXPECTED_VERSION` (`1` — the Step 05 canonical contract's lowest possible stored version, confirmed
by the `newDraftExample` fixture) and `validateExpectedVersion(value)`, which accepts only a safe-integer
`number` `>= 1` and throws `TypeError` for anything else (missing, `null`, negative, zero, fractional,
`NaN`, `±Infinity`, an unsafe integer, a numeric string, an object, an array, or an operator-like
structure such as `{ $gt: 0 }`). It has no MongoDB, Hapi, or Boom awareness and is re-exported from
`catch-persistence.js` for later callers.

`applyAuditMetadataUpdate` is the one existing-record mutation primitive and is the only place this
contract is enforced against MongoDB. Every call requires `expectedVersion`; the atomic predicate is
`{ _id: id, ownerUserId, version: expectedVersion }` and the atomic update is
`{ $set: changes, $inc: { version: 1 } }` — a single `findOneAndUpdate` call is the only concurrency
control. There is no read-then-write check anywhere in this primitive.

- **Success**: the predicate matched; `version` is incremented by exactly `1` in the same call that
  applies the allow-listed `$set`; the updated canonical record (including the new `version`) is
  returned.
- **No match**: a single further diagnostic read, `collection.findOne({ _id, ownerUserId }, { projection:
{ _id: 1 } })` — owner-scoped, version-less, and run only after the write has already failed to match —
  classifies the outcome. This read never gates, retries, or otherwise controls the write.
  - Nothing found for this owner → `null` (the same safe not-found outcome used by every other
    owner-scoped operation in this module). A genuinely missing record and a cross-owner attempt are
    indistinguishable here by construction: both return `null`, so a different owner can never learn the
    record exists.
  - A record found for this owner → the only remaining explanation is that `version` no longer matches
    `expectedVersion`. Throws `versionConflictError()` — an `ApplicationError` with category
    `VERSION_CONFLICT` (the existing Step 03 category; no new category was added) and code
    `CATCH_RECORD_VERSION_CONFLICT`. The message carries no record ID, owner ID, expected version, or
    stored version.

Callers can never set `version` directly: `assertAllowedChanges` still rejects any `changes` key outside
`['updatedAt', 'updatedBy']` — including `version` — before any Mongo call is made, and the only place
`version` changes is MongoDB's own `$inc` inside the atomic predicate above.

**Not decided here** (left to a later, unapproved decision, exactly as instructed): the HTTP transport
representation for the expected version (payload field, header, `If-Match`/ETag, or any other shape), and
whether a future successful response includes the latest version. `CatchPersistence` has no Hapi/Boom
awareness and parses no HTTP headers; `VERSION_CONFLICT` continues to map to HTTP 409 under the unchanged
Step 03 contract.

## Targeted idempotency

> Produced by Phase 3, Step 12
> (`design/github-prompts/step-12-implement-targeted-idempotency.md`; saved plan:
> `design/github-prompts/Step 12-implement-targeted-idempotency-plan.md`). A new, separate mechanism from
> optimistic concurrency above — it answers "has this duplicate-consequence operation already been
> claimed or completed for this scoped key and semantic request?", never "is this mutation based on the
> current Catch Record version?". It must never be used to bypass `applyAuditMetadataUpdate`'s
> expected-version check.

**Scope.** Idempotency is targeted, not generic. Exactly the seven operations approved by
`design/plans/catch-recording-service-detailed-implementation-plan.md` §5.2 may ever adopt it:
`DRAFT_CREATION` (first persistent draft creation), `SUBMISSION` (first submission), `EDIT_START` (edit
start when an audit event is created), `RESUBMISSION`, `ADD_FAVOURITE`, `ADD_SKIPPER`, and `COMPLETION`
(where the source may retry). **Ordinary section PATCH operations are explicitly excluded** and continue
to rely solely on the optimistic-concurrency primitive above — no generic response-replay storage exists
for them. Step 12 does not implement any of the seven operations themselves; it only provides the
primitive a later business step calls.

**Idempotency-key contract** (`idempotency-key.js`): `validateIdempotencyKey(value)` treats the key as an
opaque, client-generated value — a non-empty, printable-ASCII string (no control characters) up to
`MAX_IDEMPOTENCY_KEY_LENGTH` (`200`, a technical ceiling, not a business value). No trimming, case
conversion, prefix, or UUID-only requirement is imposed.

**Operation-scope contract** (`idempotency-operation-scope.js`): `IDEMPOTENCY_OPERATION_SCOPES` is the
closed set of exactly the seven values above; `validateOperationScope` rejects anything else. No
generic/`ANY` scope exists.

**Request-fingerprint contract** (`idempotency-fingerprint.js`): `computeRequestFingerprint({
operationScope, idempotencyKey, allowedFields, semanticInput })` builds a deterministic SHA-256 hex digest
(Node's built-in `crypto`, no new dependency) of `{ operationScope, idempotencyKey, semanticInput }`,
canonicalised with recursively sorted object keys (array order is preserved). `allowedFields` is always
supplied by the **calling later business operation** — Step 12 owns no business field name — and
`semanticInput`'s keys must be an exact subset of it; any other key, or any non-JSON-safe value (a
function, symbol, `undefined`, `Date`, or excessive nesting), is rejected before it can reach the hash.
This structurally excludes secrets, tokens, credentials, headers, correlation/trace IDs, and per-retry
timestamps — nothing not explicitly named in `allowedFields` can ever influence the fingerprint.
`assertFingerprint(value)` separately validates a pre-computed fingerprint has exactly this 64-character
lowercase hex shape, rejecting an accidental raw payload passed in its place.

**Idempotency-record contract.** A minimal MongoDB document in the dedicated `catch-idempotency-claims`
collection: `ownerUserId`, `operationScope`, `idempotencyKey`, `resourceId` (caller-supplied, or a private
internal sentinel when omitted), `fingerprint`, `state` (`'PENDING'` or `'COMPLETED'` — no third state, no
retry counter, no lock-lease field), `createdAt`, and — once completed — `completedAt` and a minimal
allow-listed `result`. No authentication token, credential, request header, request body, Catch Record
content, artifact/PDF content, stack trace, or Mongo query document is ever stored.

**Atomic first claim**: `claimIdempotency(db, { ownerUserId, operationScope, idempotencyKey, resourceId?,
fingerprint })` attempts one `insertOne`; MongoDB's unique compound index
(`{ ownerUserId, operationScope, idempotencyKey, resourceId }`) is the only uniqueness guard — never an
application-level check-then-insert, lock, or poll. Outcomes:

- **`{ outcome: 'CLAIMED' }`** — a new claim was created; the caller should now perform the durable
  consequence and call `completeIdempotencyClaim` afterwards.
- **`{ outcome: 'REPLAY', result }`** — a matching (`fingerprint`-equal) `COMPLETED` claim already exists;
  `result` is an independent copy of the stored allow-listed replay facts. The durable consequence is never
  repeated.
- **`{ outcome: 'IN_PROGRESS' }`** — a matching `PENDING` claim already exists. No error is thrown, no
  polling/waiting/takeover/stale-claim deletion occurs; the calling business operation decides how to
  represent this to its own caller (Step 12 deliberately does not pre-select an HTTP status for this case).
- Throws `IDEMPOTENCY_CONFLICT` (`IDEMPOTENCY_REQUEST_MISMATCH`) when an existing claim's stored
  `fingerprint` differs from the caller's — the same scoped key was reused for a different request. No
  record content, fingerprint, or caller identity is exposed.

**Completion operation**: `completeIdempotencyClaim(db, { ownerUserId, operationScope, idempotencyKey,
resourceId?, fingerprint, result, allowedResultFields })` atomically transitions a matching `PENDING` claim
to `COMPLETED` in one scoped `findOneAndUpdate`, storing only `result`'s allow-listed fields (validated by
the existing `assertAllowedChanges` guard — every value must be a plain string; `allowedResultFields` is,
like `allowedFields` above, always supplied by the calling business operation, never invented here).
Repeated completion with an identical `result` is deterministic (returns the stored result unchanged, no
second write); repeated completion with a **different** `result`, or completion with no matching prior
claim, both throw safely (`IDEMPOTENCY_CONFLICT`/`IDEMPOTENCY_CLAIM_NOT_FOUND`) rather than overwriting a
completed record. Never updates the Catch Record, never appends history, never increments a Catch Record
version.

**Isolation.** The composite unique index scopes every claim by `ownerUserId` (cross-caller isolation),
`operationScope` (cross-operation isolation), and `resourceId` (cross-resource isolation, where resource
identity is part of the operation) together with `idempotencyKey` — the same key reused across any of
these dimensions never collides and never leaks a result to the wrong caller/operation/resource.

**Required index**: exactly one, `{ ownerUserId: 1, operationScope: 1, idempotencyKey: 1, resourceId: 1 }`
unique — backs the first-claim guarantee, the duplicate-key classification read, and the completion
predicate (all the same filter shape or an exact prefix of it). No TTL/expiry index exists.

**Retention — explicitly not implemented.** `docs/configuration-decisions.md` already records "no
retention period is approved anywhere". Step 12 resolves this by declining to add an `expiresAt`
field, a TTL index, or a cleanup job — not by inventing a number. **This remains an owner decision required
before production use or before any later operation first depends on a bounded replay window.**

**Separation from Step 11 / Step 10.** `catch-idempotency-persistence.js` imports nothing from
`catch-persistence.js`, `catch-record-collection.js`, `catch-record-mapper.js`, or `expected-version.js`
(verified by `architecture-boundary.test.js`) — no shared mutable state, no code path that could bypass
`applyAuditMetadataUpdate`'s expected-version check. It also never reads or writes the
`catch-record-history` collection — claiming or completing an idempotency record is not a history event.

## Not-found representation

Persistence returns `null` for every "no matching owner-scoped/reference record" outcome — this is a
normal, expected result of a scoped read (or a failed compare-and-update with no owner-scoped record at
all), not an exceptional condition. A later application-layer module (CatchQuery/CatchSubmission) decides
whether/when an absent record becomes a public `RESOURCE_NOT_FOUND` `ApplicationError`. Thrown
`ApplicationError`s from this module are reserved for genuinely exceptional outcomes: duplicate-key
violations, a deterministic version conflict (see [Optimistic concurrency](#optimistic-concurrency)
above), and malformed/unexpected persistence failures.

## Error translation

| Condition                                                 | Category                      | Example code                       |
| --------------------------------------------------------- | ----------------------------- | ---------------------------------- |
| Insert duplicate `_id`                                    | `DUPLICATE_RESOURCE`          | `DUPLICATE_CATCH_RECORD_ID`        |
| Insert duplicate `catchRecordReference`                   | `DUPLICATE_RESOURCE`          | `DUPLICATE_CATCH_RECORD_REFERENCE` |
| Owner-scoped record exists but `expectedVersion` is stale | `VERSION_CONFLICT`            | `CATCH_RECORD_VERSION_CONFLICT`    |
| Malformed persisted document on read                      | `UNEXPECTED_INTERNAL_FAILURE` | `MALFORMED_CATCH_RECORD_DOCUMENT`  |
| Any other unexpected MongoDB failure                      | `UNEXPECTED_INTERNAL_FAILURE` | `CATCH_RECORD_PERSISTENCE_FAILURE` |

No new error category was added to `src/common/helpers/errors/error-categories.js` — `VERSION_CONFLICT`
is the existing Step 03 category (409, fallback code `VERSION_CONFLICT`). The original MongoDB error is
carried only as `ApplicationError`'s own internal, non-enumerable `cause` — never serialised, logged in
full, or returned publicly (the version-conflict outcome carries no `cause` at all — it is a deterministic
business-outcome branch, not a translated driver failure). Messages never include the collection name,
database name, connection string, query/update document, or stored record content.

## Security and injection protections

- `persistence-guards.js` runs before any filter/update object is built. `assertPlainString` rejects
  anything that is not a non-empty string, defeating operator-injection payloads such as `{ $ne: null }`,
  `{ $where: '...' }`, or a regular-expression object substituted for a scalar filter value.
- `assertAllowedChanges` rejects any key not on the fixed allow-list (and defensively rejects
  `__proto__`/`constructor`/`prototype`, belt-and-braces against prototype pollution).
- `assertSectionChanges`'s `assertSectionValueIsPlainObject` accepts a section value that is either a
  plain object (`trip`, `pairFishing`) or an array (`gears` — the first collection-valued section,
  approved by Step 23, Phase 6). `null` and any scalar are still rejected outright, and a plain-object
  section value is still rejected if it carries an own `__proto__`/`constructor`/`prototype` key,
  defensively. `gears` is added to the generic section-PATCH pipeline's `SECTION_ALLOW_LIST`
  (`save-catch-record-section.js`) alongside `trip`/`pairFishing` — the PATCH request's accepted
  `section` values, per-section `data` shape (object vs. array, enforced at the Joi transport boundary),
  and standard save response are otherwise unchanged. Step 23's `gears` save additionally reads the
  currently persisted record (`findCatchRecordByIdForOwner`) to source existing gear identities/nested
  dependent data for reconciliation only — the atomic `{_id, ownerUserId, version}` predicate on the
  write remains the sole concurrency control.
- `expected-version.js`'s `validateExpectedVersion` rejects anything that is not a safe-integer `number`
  `>= 1` — including an operator-like structure such as `{ $gt: 0 }` — before `expectedVersion` ever
  reaches the atomic predicate.
- Step 24 (Phase 6) extends the `gears` section save with a per-gear, optional, nullable
  `statisticalArea`: an incoming gear entry with no `statisticalArea` key leaves that gear's current
  statistical area unchanged, an entry with `statisticalArea: null` clears it, and an entry with a
  `{ id }` object resolves and replaces it — all re-resolved fresh from the Reference Data Service, never
  trusting a client-supplied snapshot. Every other gear association in the same save is left deeply
  unchanged; the single atomic `{_id, ownerUserId, version}` write predicate remains unchanged and is
  still the sole concurrency control.
- Step 25/27 (Phase 6, redesigned) extends the `gears` section save one level further, to each gear's
  `speciesCaught` collection. An incoming gear entry with no `speciesCaught` key leaves that gear's
  current species collection unchanged; an entry that owns the key (even as an empty or `null` array) is
  treated as the authoritative full species list for that gear in this save and replaces it wholesale —
  no reconciliation step is needed, because a species entry's own `id` (the authoritative species
  reference ID) is its natural key and there is no synthetic species-level `associationId` to retain or
  re-mint, exactly mirroring how gear `characteristics` have always been rebuilt from scratch on every
  save. Each species selection is resolved fresh from the Reference Data Service
  (`resolve-species-caught.js`); only the approved slim snapshot (`faoCodeSnapshot`/`nameSnapshot`) and
  the supplied weight fields/`weightPrecision` survive — never a client-supplied snapshot. The same
  authoritative species may exist independently under different gears; the same species is rejected if
  selected twice under the _same_ gear's `speciesCaught`. No "required weight present" or "at least one
  species" completeness rule is enforced at save time — that is Step 26's domain-progress concern.
- Step 27's redesign also adds a root-level, trip-level `speciesNotLanded` section to the same generic
  section-PATCH pipeline (`ARRAY_VALUED_SECTIONS` in `src/routes/catch-records.js`), identical in entry
  shape to a gear's `speciesCaught` but **not** tied to any gear and **not** reconciled against existing
  state — like `trip`, a save simply resolves every supplied entry fresh from the Reference Data Service
  (`resolve-species-not-landed.js`) and overwrites the collection wholesale; no prior read of the
  persisted record is needed for this section. It is the one approved exception to the "no root-level
  species collection" rule, which otherwise applies only to **landed** species.
- No caller-supplied object is ever passed directly as a MongoDB filter or update document — every
  filter/update is built field-by-field from guarded scalars.
- No dynamic collection selection (`CATCH_RECORD_COLLECTION` is a fixed constant) and no environment
  variable is read inside a persistence operation — the module only ever receives `db`.

## Input and output immutability

Neither mapping function mutates its input. Nested structures are independently cloned in both
directions, so a caller mutating a returned canonical record (or a stored document) can never affect the
other side. `applyAuditMetadataUpdate` does not mutate its `changes` input, and `validateExpectedVersion`
returns the supplied primitive unchanged — never coerced, rounded, or defaulted.

## Running the tests

- Unit tests (mocked `db`): `catch-record-collection.test.js`, `catch-record-mapper.test.js`,
  `persistence-guards.test.js`, `catch-persistence-errors.test.js`, `expected-version.test.js`,
  `catch-persistence.test.js`, `idempotency-key.test.js`, `idempotency-operation-scope.test.js`,
  `idempotency-fingerprint.test.js`, `catch-idempotency-collection.test.js`,
  `catch-idempotency-errors.test.js`, `catch-idempotency-persistence.test.js`.
- MongoDB integration tests (real in-memory MongoDB via `vitest-mongodb`, following
  `src/plugins/mongodb.test.js`'s existing `createServer()`/`server.db` pattern):
  `catch-persistence.integration.test.js` (including the Step 11 single-increment, stale-write, reused-
  expected-version, concurrent-write, missing-vs-conflict, and cross-owner tests) and
  `catch-idempotency-persistence.integration.test.js` (including the Step 12 first-claim, concurrent-claim,
  completed-replay, matching-in-progress, same-key-different-fingerprint conflict, cross-caller/
  cross-operation/cross-resource isolation, fingerprint-exclusion, and completion tests). Run with the
  repository's standard `npm test` (all Vitest files run together; `vitest.config.js` already configures
  `vitest-mongodb` globally).
- Architecture boundary: `architecture-boundary.test.js` (includes a closed-export-list check on
  `catch-persistence.js` and `catch-idempotency-persistence.js` so a second, competing update primitive
  cannot be added silently, and a structural-separation check proving the idempotency adapter imports none
  of Step 09/11's Catch Record mutation files).

## Explicit exclusions (not implemented by Steps 11–12)

No Hapi route, no Joi route schema, no authentication/authorisation, no draft-creation orchestration, no
business abandonment, no user-facing listing/dashboard summary, no HTTP transport representation for the
expected version (payload/header/`If-Match`/ETag — left deferred), no HTTP 412 behaviour, no idempotency
header parsing, no idempotency retention/TTL/cleanup job, no automatic history append, no Reference Data
Service integration, no friendly-reference generation, no section PATCH/replacement/submission/completion,
no artifact/PDF storage, no administrative search, no migration/compatibility/fallback behaviour, no Redis
or other application cache, no generic concurrency/transaction/locking/repository/workflow/state-machine
framework.

## Deferred decisions (not resolved here)

- Step 10's exact history collection/document shape (only the separation from the operational record is
  guaranteed by this step).
- Step 11's expected-version HTTP transport representation (payload field, header, `If-Match`/ETag, or
  any other shape), and whether a future successful response includes the latest version.
- Step 12's idempotency-record retention (no period is approved anywhere — an owner decision required
  before production use or before any later operation first depends on a bounded replay window).
- Step 12's exact operation-specific fingerprint `allowedFields` and completion `allowedResultFields` for
  each of the seven approved operations (each later business step supplies its own; Step 12 only builds
  the generic allow-list mechanism).
- Whether/how an idempotency key is transported over HTTP (header name, requirement per route) — not
  decided here.
- The final Step 28 owner-facing list-query API's filters, sorting, and paging contract (`limit` here is
  a persistence-level safety ceiling only, not that contract).
- Later section-update field mappings (`applyAuditMetadataUpdate`'s allow-list is deliberately limited to
  audit metadata; a later section-save step is expected to extend this same atomic predicate/update shape
  rather than add a competing update path).

## Catch Record history

> Produced by Phase 3, Step 10
> (`design/github-prompts/step-10-implement-simple-append-only-history.md`; saved plan:
> `design/github-prompts/Step 10-implement-simple-append-only-history-plan.md`). One simple, append-only
> Catch Record history mechanism, owned by the same `CatchPersistence` module as the section above.

### Purpose and storage decision

History is explicitly separate from the operational Catch Record: a dedicated `catch-record-history`
collection, not an embedded field on the Catch Record document. This follows the detailed plan's own
default ("use a simple history collection unless approved repository evidence demonstrates embedded
bounded history is more appropriate") — no repository evidence favours embedding, and the canonical
object document explicitly forbids embedding "a growing collection of edit events or complete historical
Catch Record copies in the operational object". A separate collection also keeps the operational
document's read/write cost independent of how much history a Catch Record accumulates over its lifetime.

History is **not** event sourcing, **not** the operational source of truth, and is never used to
reconstruct Catch Record state. It is a simple, append-only record of approved event concepts, for later
display and audit purposes only.

| File                           | Responsibility                                                                                                                                                       |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `catch-history-event.js`       | Framework-neutral contract: `CATCH_HISTORY_EVENT_TYPES`, `isSupportedHistoryEventType`, `assertSafeHistoryMetadata`, `validateHistoryEventInput` — no MongoDB import |
| `catch-history-mapper.js`      | `toHistoryDocument(event)`; `toHistoryEvent(document)`                                                                                                               |
| `catch-history-collection.js`  | `CATCH_HISTORY_COLLECTION` constant; `getCatchHistoryCollection(db)`; `ensureCatchHistoryIndexes(db)`                                                                |
| `catch-history-errors.js`      | `malformedHistoryDocumentError`, `unexpectedHistoryPersistenceError`                                                                                                 |
| `catch-history-persistence.js` | Public operations (below); re-exports `CATCH_HISTORY_COLLECTION`, `ensureCatchHistoryIndexes`, `CATCH_HISTORY_EVENT_TYPES`, `MAX_HISTORY_LIST_LIMIT`                 |

### History-event contract

Input fields (validated by `validateHistoryEventInput`, never includes `id`):

- `catchRecordId` (non-empty string, required) — the owning Catch Record's canonical `id`.
- `ownerUserId` (non-empty string, required) — trusted owner identity, supplied by the caller. Stored
  directly on each event and used as a direct MongoDB filter field, mirroring
  `findCatchRecordByIdForOwner`'s established pattern: ownership is part of the filter itself, never a
  post-query comparison and never resolved via a cross-collection join.
- `eventType` (string, required) — must be one of `CATCH_HISTORY_EVENT_TYPES`.
- `timestamp` (string, required) — a trusted, server-generated ISO-8601 UTC (`Z`-suffixed) string,
  supplied by the caller's own trusted application boundary. `CatchPersistence` never generates it — the
  future business operation that emits the event owns that decision, exactly as Step 09 never generates
  a Catch Record's own `id`/timestamps.
- `actorUserId` (non-empty string, required) — trusted actor identity, supplied by the caller.
- `metadata` (plain object, optional) — validated against the two-field allow-list below.

Output (returned by `appendCatchHistoryEvent`/`listCatchHistoryEventsForOwner`): the input fields plus a
server-generated `id` (the MongoDB `_id` converted to its hex string — never a raw `ObjectId` instance).

### Stable event types

`CATCH_HISTORY_EVENT_TYPES`: `DRAFT_CREATED`, `SECTION_SAVED`, `DRAFT_ABANDONED`, `SUBMITTED`,
`COMPLETED`, `EDIT_STARTED`, `AMENDMENT_SECTION_SAVED`, `RESUBMITTED` — the exact eight concepts named by
the detailed plan's §6 "History and audit approach". No producer for any of these events exists yet
(draft creation, section save, submission, etc. are all later steps); Step 10 implements only the
append/query mechanism and contract those future operations will call.

### Safe metadata allow-list

Exactly two optional fields, each tied to an already-approved canonical concept — not a generic metadata
bag:

- `section` — one of the Step 05 canonical nested-field names (`vessel`, `trip`, `pairFishing`, `gears`,
  `speciesNotLanded`, `artifacts`) identifying _which_ section an event relates to. A label only, never
  the section's content.
- `submissionNumber` — a bounded positive integer (1-1000), justified by the canonical
  `numberOfSubmissions` field already on the Canonical Catch Record Object v1.

Any other key — including a complete Catch Record, an artifact body, a credential, a token, a raw
dependency response, or a prototype-pollution-shaped key (`__proto__`/`constructor`/`prototype`) — is
rejected outright (throws `TypeError`), structurally, not by convention. No nested object, array, or
unbounded string can ever be stored because no allowed field is capable of holding one.

### Operations

- **`appendCatchHistoryEvent(db, input)`** — validates the input, maps it, and `insertOne`s exactly one
  document. Insert-only: no update, replace, upsert, or delete method is ever called anywhere in this
  module (verified by `architecture-boundary.test.js`'s exported-function-name check). Returns an
  independent framework-neutral copy of the appended event, including its server-generated `id`. Does not
  mutate `input`. No caller-supplied unique identifier exists, so no duplicate-identifier conflict is
  reachable through this API (MongoDB's own `_id` auto-generation already guarantees storage-level
  uniqueness).
- **`listCatchHistoryEventsForOwner(db, { catchRecordId, ownerUserId, limit })`** — owner-safe (ownership
  is part of the MongoDB filter itself), bounded (`limit` must not exceed `MAX_HISTORY_LIST_LIMIT`, 100 —
  a persistence-owned technical safety ceiling, not a business page size, mirroring Step 09's
  `MAX_LIST_LIMIT`), deterministically ordered ascending by trusted `timestamp` with an ascending `_id`
  tie-breaker for equal timestamps. An unknown `catchRecordId`, a mismatched owner, or a Catch Record with
  no history all return the same empty array — no distinguishing behaviour, no disclosure of whether
  another owner's history exists.
- **`ensureCatchHistoryIndexes(db)`** — idempotent; wired into the existing
  `src/plugins/mongodb.js` `createIndexes(db)` alongside `ensureCatchRecordIndexes`.

### Ordering decision

History is read ascending (oldest first) — a Catch Record's history is one sequence of events belonging
to that record, naturally read forward in time (draft created → section saved → … → submitted), unlike
Step 09's `listCatchRecordsByOwner` (a dashboard-style list of _distinct_ records, where newest-first is
the natural reading order). The `_id` tie-breaker is used because MongoDB `ObjectId`s are monotonically
increasing per-process at generation time, giving a stable, deterministic insertion-order proxy for
events sharing an identical trusted `timestamp`.

### Required indexes (history)

| Index                                                        | Justification                                                                                                                                                                                  |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `{ catchRecordId: 1, ownerUserId: 1, timestamp: 1, _id: 1 }` | Backs `listCatchHistoryEventsForOwner`'s exact filter (`catchRecordId` + `ownerUserId` equality) followed by its sort (`timestamp` then `_id`). No other query exists against this collection. |

No unique index is created — no caller-supplied unique business identifier exists on a history event.

### Error translation (history)

| Condition                            | Category                      | Example code                                           |
| ------------------------------------ | ----------------------------- | ------------------------------------------------------ |
| Invalid/unsupported input (contract) | n/a — plain `TypeError`       | n/a (mirrors `persistence-guards.js`'s own convention) |
| Malformed persisted document on read | `UNEXPECTED_INTERNAL_FAILURE` | `MALFORMED_HISTORY_EVENT_DOCUMENT`                     |
| Any other unexpected MongoDB failure | `UNEXPECTED_INTERNAL_FAILURE` | `CATCH_RECORD_HISTORY_PERSISTENCE_FAILURE`             |

Contract/input violations (invalid shape, unsupported event type, unsafe metadata) are plain `TypeError`s
— trusted-internal-caller contract violations, exactly mirroring Step 09's own `persistence-guards.js`
convention — not public-facing `ApplicationError`s. Only database-boundary failures (an unreadable stored
document, an actual MongoDB driver error) become the shared framework-neutral `ApplicationError`.

### Running the history tests

- Unit tests (mocked `db` / pure functions): `catch-history-event.test.js`, `catch-history-mapper.test.js`,
  `catch-history-collection.test.js`, `catch-history-errors.test.js`, `catch-history-persistence.test.js`.
- MongoDB integration tests: `catch-history-persistence.integration.test.js` — index existence, append
  one/multiple events, owner-safe query, cross-owner isolation, deterministic ordering and equal-timestamp
  tie-breaking, bounded results, empty-history behaviour, mapping round trip.
- Architecture boundary (extended): `architecture-boundary.test.js` — the new history files are checked
  for no Hapi/Boom/Joi import; the framework-neutral contract files (`catch-history-event.js`,
  `catch-history-mapper.js`) are checked for no `mongodb` import; `catch-history-persistence.js`'s public
  exports are checked to contain no update/delete/replace/upsert-shaped name.

### Explicit exclusions (not implemented by Step 10)

No event sourcing, no generic audit framework, no full field-level change history, no complete historical
Catch Record copies, no Catch Record restoration, no operational-state reconstruction from history, no
public history HTTP endpoint, no lifecycle/section-save/submission orchestration, no optimistic
concurrency (Step 11), no idempotency (Step 12), no authentication/authorisation, no Redis or application
cache, no business operation that emits any of the eight event types (those are later steps).

### Deferred decisions (history)

- Step 31's final combined lifecycle-and-audit-history HTTP response shape.
- Later event metadata owned by the future draft-creation, section-save, submission, completion,
  edit-start, amendment, and resubmission operations (beyond the two approved fields above).
- Any retention policy — none is approved yet.
- Administrative audit browsing — remains out of scope.
