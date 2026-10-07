# Configuration Decisions

> Produced by Phase 1, Step 04
> (`design/github-prompts/step-04-implement-required-configuration-contracts.md`). Records which
> configuration contracts are confirmed for this phase, and which are explicitly deferred — with the
> evidence and the step that will resolve each deferred item. No speculative value is introduced here;
> see [`docs/repository-context.md`](./repository-context.md) for the existing convict/configuration
> conventions this document follows.

## Confirmed: MongoDB connectivity

MongoDB connectivity is already fully configured and requires no change for Phase 1:

- `mongo.mongoUrl` (env `MONGO_URI`), validated by the repository's existing `mongo-uri` convict format
  (`src/common/helpers/convict/validate-mongo-uri.js`).
- `mongo.databaseName` (env `MONGO_DATABASE`).
- `mongo.mongoOptions.retryWrites` / `mongo.mongoOptions.readPreference` (env `MONGO_RETRY_WRITES` /
  `MONGO_READ_PREFERENCE`).

All defined in `src/config.js` and consumed by `src/plugins/mongodb.js`. No second MongoDB configuration
object is introduced, and no new MongoDB setting is required for the Catch Recording modules established
in Step 02, since none of them have executable persistence code yet.

## Confirmed: mandatory configuration fails safely

The existing convention — `config.validate({ allowed: 'strict' })` in `src/config.js` — already fails
fast and loud if a configuration value is missing, of the wrong shape, or an unrecognised key is present.
Phase 1 introduces no new configuration key, so there is nothing new that could fail unsafely; this
convention is simply confirmed as the one Catch Recording configuration must follow when a future step
adds a key.

## Deferred decisions

None of the following has an approved value anywhere in the approved plans, service design, or canonical
Catch Record object documents (confirmed by direct inspection, including a targeted search of
`design/architecture/canonical-catch-record-object.md` for limit/timeout/retention/URL-shaped terms, which
returned no matches). Introducing any of them now would mean inventing a business or operational decision,
which `design/github-prompts/step-04-implement-required-configuration-contracts.md` explicitly prohibits.
Each is resolved by its own later step, per
`design/plans/catch-recording-service-detailed-implementation-plan.md` §16 and
`design/architecture/catch-recording-service-design.md` §23 (both higher-precedence than this step's
broader framing).

| Deferred item                                                                                                                       | Resolved before                                                                                          | Notes                                                                                                                                                                                                                                                                                            |
| ----------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Catch Record / history / idempotency-record collection names                                                                        | Phase 3 (`CatchPersistence`, Steps 09–12)                                                                | Repository convention keeps collection names as source-level constants (e.g. `'mongo-locks'`, `'example-data'` in `src/plugins/mongodb.js`), not convict configuration. They are introduced by the module that owns them, not Step 04, and only `CatchPersistence` owns Mongo collection access. |
| Idempotency record retention                                                                                                        | Step 12                                                                                                  | No retention period is approved anywhere.                                                                                                                                                                                                                                                        |
| Business timezone                                                                                                                   | Step 17                                                                                                  | Needed for friendly-reference generation; not needed by anything implemented in Phase 1.                                                                                                                                                                                                         |
| ~~Reference Data Service base URL, timeout, retry, service authentication~~                                                         | Resolved — see [Phase 4 decisions](#phase-4-decisions-steps-1316-trust-authorisation-and-reference-data) | No longer deferred; resolved before Step 15 implementation.                                                                                                                                                                                                                                      |
| ~~S3-compatible artifact storage (endpoint, region, bucket, credentials, path-style access)~~                                       | Resolved — see "Phase 8 decisions" → "Step 33" below                                                     | No longer deferred; resolved before Step 33 implementation.                                                                                                                                                                                                                                      |
| ~~PDF safety limits (max document size, max rendered text length, rendering timeout)~~                                              | Resolved — see "Phase 8 decisions" → "Step 33" below                                                     | No longer deferred; a pragmatic rendered-item bound (`maxPdfRenderedItems`) was approved — no document-size/rendering-timeout limit was found necessary (pdfkit generation is synchronous, bounded, and in-process).                                                                             |
| HTTP payload limits                                                                                                                 | Deferred — see below                                                                                     | See "Collection and payload limits" below.                                                                                                                                                                                                                                                       |
| Domain collection limits (gears per Catch Record, species per gear, catch details per species-gear, validation-detail output limit) | Phase 2 domain validation (from Step 07) / Phase 5 section saves                                         | No numeric value approved anywhere, including the canonical Catch Record object document.                                                                                                                                                                                                        |
| Paging limits (default/max page size)                                                                                               | The read-API phase that implements listing                                                               | No numeric value approved.                                                                                                                                                                                                                                                                       |
| ~~Trusted authentication settings (user-ID/role/scope claim names, issuer/audience, trusted headers)~~                              | Resolved — see [Phase 4 decisions](#phase-4-decisions-steps-1316-trust-authorisation-and-reference-data) | No longer deferred; resolved before Step 13 implementation. No gateway-injected claims are used — identity is established by validating the caller's bearer token against the Authentication Service directly.                                                                                   |

## Collection and payload limits — the one decision flagged as blocking Step 04 itself

Unlike every other row above, `design/plans/catch-recording-service-detailed-implementation-plan.md` §16
flags **"Final collection and payload limits"** as a decision required specifically **before Step 04**,
not before a later step. No numeric value for any HTTP payload limit or domain-collection limit appears
anywhere in the approved plans, service design, or canonical Catch Record object documents.

This was raised to the service owner during Step 04 (per the step prompt's Clarification Resolver / user-
escalation policy — inventing a number, or shipping a "mandatory, no default" contract that would break
today's local/test startup, were both rejected as unsafe). The owner's decision, recorded here:

> Defer entirely for Phase 1. No collection or payload-limit configuration is added. This remains an open
> decision for the phases that actually enforce it: domain validation (Phase 2, from Step 07) for the
> per-gear/per-species/per-catch-detail collection limits, and section-save/body-size enforcement
> (Phase 5 onward) for the payload byte limit; general listing/paging limits are resolved by whichever
> phase implements the read API.

No `server.payload.maxBytes` override, Joi array `.max()`, or paging default is introduced by Phase 1;
Hapi's own built-in default payload limit continues to apply implicitly until an approved number replaces
it.

## Phase 4 decisions (Steps 13–16): trust, authorisation, and reference data

> Recorded ahead of Step 13 implementation, after a risk-scoped research pass against this programme's own
> sibling repositories (`mmo-cr-reference-data-service`, `mmo-cr-authentication-service`) and user
> confirmation. These sibling services are part of the same replacement programme and are treated as
> direct, authoritative evidence — not external/third-party precedent. Every item below is a project
> decision, confirmed by the service owner; none is invented.

### Trusted authentication (Step 13)

The Authorisation Service does not yet have a confirmed real contract; a mock instance
(`mmo-cr-authentication-service`) currently authorises every request. Catch Recording integrates against
its real (mocked) HTTP contract directly, mirroring the already-implemented client in
`mmo-cr-reference-data-service` (`src/reference-data/validation/authentication/http-authentication-client.js`):

- `POST {AUTHENTICATION_SERVICE_URL}/validate`, header `Authorization: Bearer <token>` (the token forwarded
  from the caller), plus the existing `tracing.header` (`x-cdp-request-id`) correlation header.
- Success body: `{ actorId: string, permissions: string[] }`. `actorId` is the trusted user ID.
  `permissions` is used directly as the caller's approved scopes — there is **no separate "role" claim**;
  the design doc's "roles and scopes" language is resolved as a single flat `permissions`/scopes list, per
  owner confirmation.
- A missing token, an invalid/expired token, or an unavailable Authentication Service are all
  authentication failures mapped to the existing `AUTHENTICATION_FAILURE` category → `401`. No raw token,
  claim, or Authentication Service response body is logged or exposed publicly.
- Config: `authentication.baseUrl` (env `AUTHENTICATION_SERVICE_URL`), `authentication.timeoutMs`
  (env `AUTHENTICATION_SERVICE_TIMEOUT_MS`, default `2000`), `authentication.retryCount`
  (env `AUTHENTICATION_SERVICE_RETRY_COUNT`, default `1`), `authentication.retryDelayMs`
  (env `AUTHENTICATION_SERVICE_RETRY_DELAY_MS`, default `100`) — retrying only `502`/`503`/`504`.

### Resource authorisation (Step 14)

- **Vessel-permission source**: the Reference Data Service's own vessel endpoints —
  `GET /api/v1/reference-data/vessels` and `GET /api/v1/reference-data/vessels/{id}` — called with the
  caller's trusted context. The response is assumed already scoped to vessels that caller may access;
  vessel access is granted when the vessel ID is present in/returned by that user-scoped lookup.
- **Restricted completion permission**: no fixed role/scope name is hard-coded as a business rule. The
  completion endpoint requires an authenticated actor whose `permissions` includes the placeholder
  permission `catch-recording.complete` (named consistently with this programme's existing
  `reference-data.read`/`reference-data.write` convention). The real authorisation decision is delegated to
  the Authentication Service's response, so renaming this placeholder later is a one-constant change.

### Reference Data Service client (Step 15)

- **Endpoints**: `GET /api/v1/reference-data/{vessels,ports,species}/{id}` for vessels/ports/species
  (self-contained item responses). **Gears use the collection endpoint with an `ids` filter instead of
  the item endpoint** — `GET /api/v1/reference-data/gears?ids=<id>&includeInactive=true` — because a
  gear's `applicableCharacteristics[].characteristicId` only resolves to a name/unit via the **collection
  envelope's** top-level `characteristics[]` catalog, which the item endpoint (`/gears/{id}`) does not
  return (confirmed directly from the Reference Data Service's own controller: the item handler returns
  only the matched gear, never the collection-level catalog). `includeInactive=true` is required on this
  filtered-collection call so an inactive gear already referenced by a historical Catch Record remains
  resolvable by ID, matching the item endpoint's own behaviour for the other types. Plus **statistical
  areas** (added as an addendum after the detailed implementation plan's own decision list flagged "exact
  endpoint for statistical-area retrieval" as required before Step 15, which the original research pass
  missed): `GET /api/v1/reference-data/map/statistical-areas/{id}` only (the item lookup; Catch Recording
  never needs the bounded collection/search endpoint, since a statistical area is always resolved by the
  one stable ID the user already selected). No separate species-attributes endpoint exists or is called —
  species "attributes" are not a Reference Data Service concept at all (see below).
- **Request contract**: canonical representation only — **no `view` query parameter is ever sent**
  (no mobile view is used). Supported query parameters: `ids` (comma-separated GUIDs, max 50), per-dataset
  exact filters, `includeInactive` (`true`/`false`, default `false`), `sort`, `offset`/`limit`
  (default 50 / max 500). The statistical-area item endpoint takes no query parameters.
- **Response contract**: the canonical collection-envelope schemas as implemented in
  `mmo-cr-reference-data-service` (`dataset, collectionId, schemaVersion, version, itemCount, items[]`),
  with dataset item shapes: vessel (`id, name, namePln, identifiers{cfr,uvi,mmsi,ircs,externalMark,
registrationNumber}, lengthOverallMetres, status, activeFrom, activeTo`), gear (`id, code, name, type,
categoryId, pairFishing, applicableCharacteristics[{id,characteristicId,fixed,required,
vesselLengthApplicability?}], active`, joined by the client with the collection-level
  `characteristics[{id,code,name,dataType,unit,minValue,maxValue}]` catalog into one resolved
  `characteristics[{characteristicId,fixed,required,name,unit,dataType,minValue,maxValue,
vesselLengthApplicability}]` array on the client's returned gear result — `categories[]` is not consumed
  (gear snapshots use only the gear's own code/name, never its category)), port (`id, code, name,
countryCode, coordinate, active`), species (`id, faoCode, scientificName, commonNames[], localNames[],
active`). **Statistical area** uses a GeoJSON `Feature`
  shape, not the flat JSON item shape of the other three types: `{ type: 'Feature', id, properties: { id,
code, name, areaType, parentCode?, parentName?, areaKm2?, centroid? }, geometry }` — only
  `properties.id`/`code`/`name` are consumed by Step 15/16; `areaType`, `parentCode`, `parentName`,
  `areaKm2`, `centroid`, and `geometry` are read-but-unused today (exposed on the client result only if a
  future approved consumer needs them, never invented fields beyond what the schema above confirms).
- **Service-to-service authentication**: `Authorization: Bearer <token>`, validated by the same
  Authentication Service `/validate` contract as Step 13. **Addendum (resolving the token-issuance gap
  flagged in the original research):** Catch Recording presents its **own** configured service
  credential, not the inbound caller's bearer token — the step prompt explicitly discourages
  caller-token-forwarding "unless explicitly approved", and no such approval exists. The credential is a
  static, secret-sourced token (`referenceData.serviceToken`, never logged, never a placeholder default),
  matching the "shortest safe implementation" philosophy — no OAuth client-credentials dance or signed
  JWT is introduced without an approved requirement for one.
- **Timeout / retry**: `referenceData.timeoutMs` (env `REFERENCE_DATA_SERVICE_TIMEOUT_MS`, default `2000`),
  one bounded retry (`referenceData.retryCount` / `REFERENCE_DATA_SERVICE_RETRY_COUNT`, default `1`,
  `referenceData.retryDelayMs` / `REFERENCE_DATA_SERVICE_RETRY_DELAY_MS`, default `100`), retrying only
  transient `502`/`503`/`504` failures — never `4xx`.
- **Config**: `referenceData.baseUrl` (env `REFERENCE_DATA_SERVICE_URL`), `referenceData.serviceToken`
  (env `REFERENCE_DATA_SERVICE_TOKEN`, nullable, never defaulted to a non-null value), alongside the
  timeout/retry keys above.

### Reference validation and snapshot resolution (Step 16)

- **Active-selection semantics**: vessel — `status === 'active'` (string field); gear/port/species — a
  boolean `active` field. A collection query defaults to active-only (`includeInactive=false`); a direct
  item-by-ID lookup always returns the item regardless of active state, so a historical/inactive reference
  already stored on a Catch Record can still be validated and re-displayed. **Statistical area has no
  active/inactive field at all** in the confirmed Reference Data Service schema — every statistical area
  returned by the item endpoint is treated as active; no active-selection rule is applied to this type.
- **Snapshot mapping** (canonical response field → approved `Snapshot` property in
  `canonical-catch-record-object.md` — no mobile view is used):
  - Vessel → `rssSnapshot` ← `identifiers.registrationNumber`; `nameSnapshot` ← `name`;
    `externalMarkSnapshot` ← `identifiers.externalMark`; `lengthOverallMetresSnapshot` ← `lengthOverallMetres`.
  - Departure/return port → `codeSnapshot` ← `code`; `nameSnapshot` ← `name`.
  - Gear → `codeSnapshot` ← `code`; `nameSnapshot` ← `name`.
  - Gear characteristic → `nameSnapshot` ← `name`; `unitSnapshot` ← `unit`.
  - Statistical area → `codeSnapshot` ← `properties.code`; `nameSnapshot` ← `properties.name` (read from
    the GeoJSON Feature's `properties`, not root-level fields, per the confirmed schema).
  - Species → `faoCodeSnapshot` ← `faoCode`; `nameSnapshot` ← the first `commonNames[]` entry, falling
    back to `scientificName` when no common name is present (no mobile-view display-name resolver is used).
- Historical snapshots already stored on a Catch Record are never rewritten merely because current
  reference data changed or became inactive.

### Species weight fields — not Reference Data Service concepts (superseded by the Step 27 redesign)

Per `design/architecture/species-property-completion.md`, the per-species weight values
(`weightAboveMinimumKg`, `weightBelowMinimumKg`, `weightLegallyDiscardedKg`) are Catch Recording's own
captured data, not Reference Data Service reference data — there is no RDS endpoint for them and none is
called.

> **Superseded (Step 27 redesign):** the original small, fixed `catchDetails[].attributeId` catalogue
> (`LSC`/`BMS`/`DIS`) described here has been replaced by three fixed, optional weight fields directly on
> each species entry — see "Step 27 redesign: canonical species/landing model" below for the approved
> replacement shape and field names.

### Multi-gear completeness and domain progress (Step 26) — approved decisions

No approved document fully specified the exact per-gear completeness rules before this step, so the
following were confirmed by the service owner (Clarification Resolver escalation, Phase 6):

- **Required characteristics** — the Reference Data Service's gear catalogue `required` flag (and
  `vesselLengthApplicability`) exists only transiently during the Step 23 save-time resolution and is
  never persisted on the Catch Record. Re-fetching it during progress calculation would make completeness
  a live-dependency, non-deterministic function of the persisted record, which this step's own
  reliability requirements forbid ("evaluate the in-memory canonical record without unnecessary external
  calls"; "produce deterministic output for equivalent canonical input"). **Approved decision: Step 26
  stays a pure, synchronous, dependency-free function. "Required characteristics" completeness is
  evaluated as "at least one characteristic is supplied" (presence), not exact required-ID matching.**
  `vesselLengthApplicability` is not evaluated at all under this decision.
- **Required catch details** — superseded by the Step 27 redesign (see below): completeness is now
  evaluated against the flat weight fields directly, not a `catchDetails[]` catalogue. **Approved
  decision (unchanged in substance): "at least one weight field present on at least one species entry for
  the gear" is the completeness bar** — no specific weight field is individually mandatory.
- **Empty/absent `gears` collection** — `allGearsComplete` is `false` whenever `gears` is empty or absent;
  it is never vacuously `true` merely because there is nothing to be incomplete. The canonical hierarchy
  requires one or more gears, so "no gears yet" is treated as incomplete.
- **`currentIncompleteGearAssociationId`** — returned only when exactly one gear is incomplete; `null`
  (never a guessed/priority-ordered value) when zero or more than one gear is incomplete. **Approved
  decision (service owner):** deciding which incomplete gear to address next, when more than one is
  incomplete, is the frontend's journey-sequencing concern, not a backend-invented priority rule — a
  "check your answers" page at the end of the journey is responsible for full-journey completeness, while
  the backend's role is only to confirm each individual part (each gear/section) is complete per request.
- **`submissionEligible`** — not composed by this step. It is not yet an approved field of the Step 22
  standard save-response contract, and prematurely claiming full submission eligibility while
  complete-record validation (Step 32) remains unevaluated would be incorrect.

### Step 27 redesign: canonical species/landing model — approved decisions

Mid-way through Step 27 ("landing intention and retained-catch consistency"), the service owner confirmed
that none of Step 27's prerequisite decisions (`landing.intention` allowed values, `retainedSpecies`
shape, `notLandingDetails` rules) had ever been approved anywhere in the repository — they were genuinely
undecided product questions, not an implementation gap. Rather than inventing values for an architecture
the service owner no longer wanted, the service owner replaced the entire `landing`/`retainedSpecies`
model with a new canonical shape (Clarification Resolver escalation, Phase 6). This fully supersedes
Steps 23–26's original `speciesCaught[].associationId`/`catchDetails[].attributeId` shape, which has been
reworked to match. The following were confirmed directly by the service owner:

- **`landing`/`retainedSpecies`/`notLandingDetails` are eliminated entirely.** There is no landing
  intention concept in the canonical contract. Step 27's actual remaining scope is "implement the
  `speciesNotLanded` root section", not "landing intention and retained-catch consistency" as originally
  titled.
- **Flat species-weight entry shape** replaces the old `{ associationId, species: { id, ... },
catchDetails: [{ attributeId, value, ... }] }` nesting. Both `gears[].speciesCaught[]` and the new
  root-level `speciesNotLanded[]` use the identical shape: `{ id, faoCodeSnapshot, nameSnapshot,
weightAboveMinimumKg?, weightBelowMinimumKg?, weightLegallyDiscardedKg?, weightPrecision? }`. A
  species' own authoritative `id` is its natural key — there is no separate species-level
  `associationId`, and no catch-detail attribute catalogue.
- **Weight values are numbers, never strings** — even though an early illustrative example used string
  values, the approved canonical type is `number | null`.
- **`weightPrecision` has exactly two approved values: `wholeNumber` and `oneDecimalPlace`.** No other
  value is approved, and there is no cross-validation between `weightPrecision` and the actual decimal
  places of a supplied weight value — it is a display hint only.
- **Species snapshot uses the approved slim convention** (`id` + `faoCodeSnapshot`/`nameSnapshot`), not
  the full Reference Data Service response shape (name/faoCode/scientificName/commonNames/localNames/
  isActive) shown in an early illustrative example — consistent with every other reference selection in
  this service (gear, statistical area, ports).
- **Root-level `speciesNotLanded` is the one approved exception to "no root-level species collection".**
  That architecture rule was always intended to apply only to **landed** species (`gears[].speciesCaught`,
  which must stay tied to the gear that caught it); species caught but not landed are trip-level by
  nature (not meaningfully tied to a single gear), so a root-level, trip-level collection is the correct
  shape for them. `speciesNotLanded` is independent of `gears` - the same species may appear in both
  collections, and no cross-reference check is applied between them.

## Phase 7 decisions (Steps 28–31): queries, synchronisation, and history

> Recorded ahead of implementation, after a Clarification Resolver pass against repository evidence
> (existing `listCatchRecordsByOwner`/`listCatchHistoryEventsForOwner` persistence primitives, the
> Step 22 standard save-response contract, the Step 11 expected-version/conflict contract, and
> `docs/adr/0001-flat-species-weight-entries-and-species-not-landed.md`) plus explicit user confirmation
> for the items no repository evidence could resolve.

- **Bounded-list page size (`GET /v1/catch-records` and `GET /v1/catch-records/{id}/history`)**: `limit`
  is an optional query parameter, default `20`, max `100` (the existing `MAX_LIST_LIMIT`/
  `MAX_HISTORY_LIST_LIMIT` technical ceilings). No offset/cursor paging is implemented — both existing
  persistence primitives only ever supported a bounded `limit`, and no approved document anywhere
  mandates multi-page client paging.
- **Listing filter**: only the persisted lifecycle `status` (`DRAFT`/`SUBMITTED`/`COMPLETE`) — no vessel
  or date filter, since neither has any approved evidence. No client-controlled sort parameter; the
  existing deterministic default order (`createdAt` descending, `_id` ascending tie-break) is used as-is.
- **Response envelopes**: the Step 28 list envelope is `{ items, limit, count }`; the Step 29 complete
  retrieval returns the full canonical record plus `{ displayStatus, sectionCompletion,
completedSections, incompleteSections, progress, submissionEligible }`; the Step 30 `PUT` success
  response reuses the existing Step 22 `buildStandardSaveResponse` shape unchanged; the Step 31 history
  envelope is `{ catchRecordId, status, displayStatus, version, hasUnsubmittedChanges,
numberOfSubmissions, events: [{ id, eventType, timestamp, actor, section?, submissionNumber? }] }`.
- **Step 30 maximum mobile payload size**: `1 MB` (`1,048,576` bytes), enforced via the route's
  `payload.maxBytes`. No earlier approved value existed anywhere (this was the one decision the Step 04
  plan explicitly flagged as blocking, then deferred — see above).
- **Step 30 idempotency**: not implemented. Optimistic concurrency (the existing expected-version
  contract) is sufficient; no approved mobile-retry requirement exists, matching the existing PATCH
  section-save precedent (also no idempotency).
- **Step 30 vessel inclusion**: `vessel` is part of the complete-replacement payload and is re-resolved/
  re-authorised on every `PUT` (`listAccessibleVesselIds` + `resolveVessel`, exactly as at draft
  creation) — `normaliseCatchRecord`'s approved client-owned section set already includes it; PATCH's
  narrower section allow-list does not make it immutable for a complete replacement.
- **Step 30 expected-version/conflict contract**: reuses the existing `If-Match` header
  (`/^[1-9]\d*$/`) and the existing `VERSION_CONFLICT`/`CATCH_RECORD_VERSION_CONFLICT` (HTTP 409)
  contract unchanged — no new header or status code.
- **Step 30 lifecycle protection**: only a `status = DRAFT` record (never-submitted or amended) may be
  replaced, enforced atomically inside the same compare-and-update predicate as the expected-version
  check (mirrors Step 19's `deleteEligibleDraftForOwner`). `SUBMITTED`/`COMPLETE` are rejected with
  `INVALID_LIFECYCLE_TRANSITION` — Step 37's edit-start (Phase 8, not yet implemented) remains the only
  approved way back to `DRAFT`.
- **Step 30 reconciliation scope**: the step prompt's "landing"/"retained-catch" language predates
  ADR 0001. The current canonical contract has no separate landing/retained-catch structure — Step 30
  reconciles exactly `gears[].speciesCaught[]` (per gear, via the existing Step 23/25/27 resolution
  pipeline) and root-level `speciesNotLanded[]`; no new reconciliation concept is introduced.
- **Step 30 business validation**: reuses the existing per-section validators
  (`validateTrip`/`validatePairFishing`/`validateGears`/`validateSpeciesNotLanded`) — the same ones the
  existing PATCH pipeline already dispatches — rather than the aggregate `validateCatchRecord`/
  `validateStructure`. Discovered during implementation: `validateStructure`'s gear-structure rule
  requires `associationId` on every gear unconditionally, which is correct for an already-_reconciled_
  persisted canonical record (what Step 32 will validate) but wrong for a pre-reconciliation payload that
  may legitimately add a brand-new gear with no client-supplied `associationId` yet (exactly as the
  existing PATCH `gears` section already permits).
- **Step 30/31 history event**: one new, distinct event type, `COMPLETE_REPLACEMENT_SAVED`, added to the
  existing closed nine-type catalogue (`CATCH_HISTORY_EVENT_TYPES`) — no existing type unambiguously
  represented "every client-owned section replaced in one atomic write". No section/submission-number
  metadata applies to a whole-object replacement, so none is attached.
- **Step 31 public event types/actor representation**: the existing stable internal `eventType` strings
  are exposed as-is (no internal/public translation table — mirrors how persisted lifecycle `status` is
  already exposed directly). The trusted `actorUserId` is exposed directly as `actor` (a single-actor-
  per-record system; no pseudonymisation or categorisation is invented).

## Phase 8 decisions (Steps 32-38): submission, artifacts, completion, and amendment

> Recorded ahead of/during implementation. Most Phase 8 contract decisions were already evidenced by
> infrastructure built ahead of this phase (the lifecycle-transition domain policies, idempotency
> operation scopes, history event types, and resource-authorisation policies all already existed with
> Phase 8 in mind) — only genuinely open items required a fresh decision.

### Step 32: complete-validation

- **No optional `POST /v1/catch-records/{catchRecordId}/validation` endpoint.** The approved condition
  for adding it ("an authoritative UI requirement confirms a need to validate without submitting") has no
  supporting evidence anywhere in the repository — the same absence-of-evidence reasoning already applied
  to deferring `submissionEligible` composition in Step 26. The reusable `validateSubmissionReadiness`
  capability is implemented in full and ready for Steps 34/38 to call; it is simply not independently
  exposed over HTTP.
- **Gear completeness is a mandatory dimension of complete-validation**, reusing Step 26's `isGearComplete`
  bar unchanged (not re-implemented) — an in-progress gear that is valid for an ordinary section save
  must still fail complete-validation.
- **Landing intention / retained-catch consistency**: the step prompt's original language is superseded
  by the Step 27 redesign (`docs/adr/0001-flat-species-weight-entries-and-species-not-landed.md`) — there
  is no landing-intention concept in the canonical contract. Complete-validation instead revalidates every
  `gears[].speciesCaught[]` and root-level `speciesNotLanded[]` entry's reference validity; no
  landing/retained-catch cross-check is invented.
- **Reference-data revalidation scope**: vessel, departure/return ports, each gear, each gear's
  statistical area, and every species entry (`speciesCaught` and `speciesNotLanded`) are revalidated for
  existence and current active-selection. Gear-characteristic, gear↔area, and gear↔species _relationship_
  revalidation is not attempted — the same recorded Step 16 gap (neither schema carries a gear-reference
  field).

### Step 33: immutable JSON and PDF artifact capabilities

No approved value existed anywhere for any of the following (`docs/configuration-decisions.md` already
flagged all of them as deferred to this step). Resolved pragmatically for a greenfield service with no
production traffic yet, documented here as decisions rather than invented silently:

- **Storage SDK**: `@aws-sdk/client-s3` — consistent with the pre-existing (previously unused)
  `@aws-sdk/credential-providers` dependency already in `package.json`, and the only AWS-maintained S3
  client compatible with the local `floci` emulator already provisioned in `compose.yml`.
- **PDF library**: `pdfkit` — a pure-JS, no-native-binary, no-browser-automation dependency, consistent
  with this repository's existing dependency-minimalism (no Puppeteer/Chromium or similar heavyweight
  rendering engine is introduced).
- **Deterministic key structure**:
  `catch-records/{catchRecordId}/submissions/{submissionNumber}/{snapshot.json|receipt.pdf}` — server
  generated from a validated `(catchRecordId, submissionNumber, type)` triple only.
- **Immutability mechanism**: a pre-write `HeadObject` existence check plus checksum comparison (see
  `docs/catch-recording-artifacts.md`), explicitly documented as a local-development/early-production
  substitute for true conditional-write/object-lock immutability — not claimed as distributed-transaction
  safety.
- **Artifact integrity metadata**: a SHA-256 hex checksum (Node's built-in `crypto`, the same primitive
  `idempotency-fingerprint.js` already uses) plus content type and content length — never the artifact
  body itself.
- **PDF accessibility**: best-effort only (document title/language metadata, native selectable/searchable
  text, logical reading order). Full tagged-PDF/PDF-UA structure-tree conformance is explicitly **not**
  implemented or claimed, since no approved conformance target exists anywhere in the repository and
  `pdfkit` cannot produce a genuine structure tree without one being deliberately built.
- **Artifact retention**: no retention/deletion/archival behaviour is implemented — no approved
  requirement exists for any of it.
- **Credentials**: none configured by this service directly — the AWS SDK's own default credential
  provider chain is used unchanged (env vars locally via `compose/aws.env`, an IAM task role in deployed
  CDP environments).

### Step 34: idempotent submission

- **Idempotency-Key is optional**, not mandatory — extends the Step 18 draft-creation precedent
  unchanged (applied only when the caller supplies one).
- **Idempotency replay is checked before lifecycle eligibility** (not after) — a retried request whose
  first attempt already succeeded would otherwise fail the lifecycle check (record no longer `DRAFT`)
  before ever reaching the stored replay result.
- **One atomic persistence primitive (`applySubmission`) serves both first submission and resubmission**
  — both source states are persisted `DRAFT`, so the same predicate (`status: DRAFT` alongside
  id/owner/version) safely gates both, mirroring `applyCompleteReplacement`'s established pattern. The
  caller (not the primitive) decides which lifecycle policy accepted the request and which history event
  type to append.
- **Deterministic recovery is implemented via a check-existing-JSON-artifact-first strategy** (see
  `docs/catch-recording-submission.md`) - this is the one piece of behaviour genuinely new to this step,
  since Step 33's immutability mechanism alone does not explain how a _retried_ request produces
  byte-identical content to reuse. No durable submission-operation record is introduced — evidence does
  not yet show the deterministic mechanism is insufficient.
- **PDF determinism for recovery**: `PDFGenerator` fixes the embedded PDF `CreationDate` metadata field
  from the snapshot's own `submittedAt` (never wall-clock `new Date()`), so regenerating a PDF from an
  identical (possibly recovered) snapshot produces byte-identical output — required for the recovery
  path's artifact-reuse check to succeed rather than raising a false integrity conflict.
- **Submission response** extends the existing `buildStandardSaveResponse` shape with `submittedAt`,
  `submittedBy`, and the complete `artifacts` array — no new, incompatible response shape.
- **Artifact-key safety guard relaxed from strict-UUID to a general safe-bounded-identifier pattern**
  (`^[0-9a-zA-Z_-]{1,100}$`): no other boundary in this service (Joi route-parameter validation, Mongo
  `_id`) actually requires `catchRecordId` to be UUID-shaped specifically — only that it be safe to place
  inside an object-storage key (no path separators, no dot-segments). Assuming UUID shape was an
  unevidenced, unnecessarily narrow constraint.

### Step 35: submission artifact listing and retrieval

- **Public artifact-type values are `json`/`pdf`** (not the persisted `JSON_SNAPSHOT`/`PDF_RECEIPT`
  values) — a closed, explicit, case-sensitive mapping (`artifact-keys.js`), consistent with REST
  convention and avoiding exposure of internal persisted enum values over HTTP.
- **Listing response fields**: `submissionNumber` plus, per artifact, `type`/`contentType`/
  `contentLength`/`checksum` — no presigned URL or `_links` field (no evidence anywhere approves backend-
  generated links).
- **Buffered, not streamed, retrieval** — no evidence anywhere in the repository suggests artifact sizes
  large enough to need streaming (JSON snapshots and single-page PDF receipts are inherently small).
- **`Content-Disposition: attachment`** for both JSON and PDF — treated uniformly as downloadable
  evidence rather than browser-rendered content, avoiding inconsistent per-browser inline-rendering
  behaviour for JSON.
- **Filename convention**: `{catchRecordReference}-submission-{submissionNumber}.{json|pdf}`, generated
  entirely server-side.

### Step 36: restricted completion

- **Completion permission**: already resolved before Phase 8 — the exact `catch-recording.complete`
  scope (`completion-policy.js`, confirmed in `docs/catch-recording-authorisation.md`'s Phase 4
  decisions). No new permission name is invented.
- **No completion evidence or request payload** — no approved requirement exists for either; only the
  existing lifecycle precondition (`SUBMITTED`) gates the transition.
- **Idempotency-Key is optional**, scoped by the completing administrator's own identity (not the
  record's owner, since completion has no owner concept) — extends the same optional-header pattern used
  throughout Phase 8.
- **A new, not-owner-scoped persistence primitive (`applyCompletion`) and read (`findCatchRecordById`)**
  were introduced specifically for this step — every other `CatchPersistence` primitive is owner-scoped,
  but completion is deliberately exempt per the approved Phase 4 decision that completion is "purely
  permission-gated".
- **Response** extends `buildStandardSaveResponse` with `completedAt`/`completedBy` — no new,
  incompatible shape.

### Step 37: edit-start amendment reason

- **No amendment-reason request field.** Zero evidence of this field exists anywhere in the canonical
  contract, the domain lifecycle policies (`buildEditStartFacts` takes no `reason` parameter), or any
  approved document. Edit-start is implemented as a no-request-body `POST`, consistent with "do not invent
  a reason field or validation limits".
- **Eligible source states**: both `SUBMITTED` and `COMPLETE` (confirmed by the pre-existing
  `canStartEdit` domain policy, built ahead of this step) — an already-`DRAFT` record is not eligible.
  Both share identical authorisation/evidence/history treatment; no divergent behaviour between the two
  source states is approved anywhere.
- **Idempotency-Key is optional**, owner-scoped — the same pattern as submission.
- **Response reuses the unmodified standard save response** — `hasUnsubmittedChanges` and
  `numberOfSubmissions` are already present via its existing `progress` field, so no response-shape
  extension was needed.

### Step 38: amendment saves and resubmission

- **No new endpoints** — amendment saves reuse the existing generic section `PATCH`; resubmission reuses
  the existing `POST .../submission` (Step 34's `submitCatchRecord` already handled resubmission; no
  change was needed there).
- **`applySectionUpdate` gains a `status: DRAFT` predicate condition** (previously absent) — discovered
  during this step that nothing prevented a section `PATCH` from applying directly to a
  `SUBMITTED`/`COMPLETE` record, bypassing edit-start. This is a scoped, tightly-coupled fix: Step 38's
  own "preservation of DRAFT" requirement cannot hold unless `PATCH` actually enforces it.
- **Amendment-save history event type is derived from the already-returned updated document** (an
  amended draft check on the post-update record), not a separate pre-read — `applySectionUpdate` never
  touches `numberOfSubmissions`, so this is equivalent and avoids an extra database read per section
  save.

## Security and privacy

No credential, token, access key, or secret key is introduced by this step (none was added — there is no
new configuration at all). Nothing in this document reproduces a secret value; the local `floci` S3-
emulator credentials referenced above are the well-known public dummy values used by that local tool, not
a real secret, and are not reproduced here regardless.
