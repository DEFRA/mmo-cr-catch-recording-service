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

| Deferred item                                                                                                                       | Resolved before                                                                                          | Notes                                                                                                                                                                                                                                                                                                                            |
| ----------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Catch Record / history / idempotency-record collection names                                                                        | Phase 3 (`CatchPersistence`, Steps 09–12)                                                                | Repository convention keeps collection names as source-level constants (e.g. `'mongo-locks'`, `'example-data'` in `src/plugins/mongodb.js`), not convict configuration. They are introduced by the module that owns them, not Step 04, and only `CatchPersistence` owns Mongo collection access.                                 |
| Idempotency record retention                                                                                                        | Step 12                                                                                                  | No retention period is approved anywhere.                                                                                                                                                                                                                                                                                        |
| Business timezone                                                                                                                   | Step 17                                                                                                  | Needed for friendly-reference generation; not needed by anything implemented in Phase 1.                                                                                                                                                                                                                                         |
| ~~Reference Data Service base URL, timeout, retry, service authentication~~                                                         | Resolved — see [Phase 4 decisions](#phase-4-decisions-steps-1316-trust-authorisation-and-reference-data) | No longer deferred; resolved before Step 15 implementation.                                                                                                                                                                                                                                                                      |
| S3-compatible artifact storage (endpoint, region, bucket, credentials, path-style access)                                           | Step 33 (and the artifact-implementation decisions before it)                                            | Local `floci` infrastructure exists in `compose.yml` (region `eu-west-2`, dummy local credentials), but "do not assume local emulator credentials or endpoint behaviour applies to deployed environments" — no approved deployed bucket/region/credential strategy exists yet, and no `CatchArtifact` code exists to consume it. |
| PDF safety limits (max document size, max rendered text length, rendering timeout)                                                  | Step 33                                                                                                  | No numeric value approved; no `PDFGenerator` code exists yet.                                                                                                                                                                                                                                                                    |
| HTTP payload limits                                                                                                                 | Deferred — see below                                                                                     | See "Collection and payload limits" below.                                                                                                                                                                                                                                                                                       |
| Domain collection limits (gears per Catch Record, species per gear, catch details per species-gear, validation-detail output limit) | Phase 2 domain validation (from Step 07) / Phase 5 section saves                                         | No numeric value approved anywhere, including the canonical Catch Record object document.                                                                                                                                                                                                                                        |
| Paging limits (default/max page size)                                                                                               | The read-API phase that implements listing                                                               | No numeric value approved.                                                                                                                                                                                                                                                                                                       |
| ~~Trusted authentication settings (user-ID/role/scope claim names, issuer/audience, trusted headers)~~                              | Resolved — see [Phase 4 decisions](#phase-4-decisions-steps-1316-trust-authorisation-and-reference-data) | No longer deferred; resolved before Step 13 implementation. No gateway-injected claims are used — identity is established by validating the caller's bearer token against the Authentication Service directly.                                                                                                                   |

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

- **Endpoints**: `GET /api/v1/reference-data/{vessels,gears,ports,species}` and
  `GET /api/v1/reference-data/{vessels,gears,ports,species}/{id}`, plus **statistical areas** (added as an
  addendum after the detailed implementation plan's own decision list flagged "exact endpoint for
  statistical-area retrieval" as required before Step 15, which the original research pass missed):
  `GET /api/v1/reference-data/map/statistical-areas/{id}` only (the item lookup; Catch Recording never
  needs the bounded collection/search endpoint, since a statistical area is always resolved by the one
  stable ID the user already selected). No separate gear-characteristics or species-attributes endpoints
  exist or are called — gear characteristics are nested inside the `gears` collection/item response;
  species "attributes" are not Reference Data Service concepts at all (see below).
- **Request contract**: canonical representation only — **no `view` query parameter is ever sent**
  (no mobile view is used). Supported query parameters: `ids` (comma-separated GUIDs, max 50), per-dataset
  exact filters, `includeInactive` (`true`/`false`, default `false`), `sort`, `offset`/`limit`
  (default 50 / max 500). The statistical-area item endpoint takes no query parameters.
- **Response contract**: the canonical collection-envelope schemas as implemented in
  `mmo-cr-reference-data-service` (`dataset, collectionId, schemaVersion, version, itemCount, items[]`),
  with dataset item shapes: vessel (`id, name, namePln, identifiers{cfr,uvi,mmsi,ircs,externalMark,
registrationNumber}, lengthOverallMetres, status, activeFrom, activeTo`), gear (`id, code, name, type,
categoryId, pairFishing, applicableCharacteristics[], active`, plus collection-level `categories[]` /
  `characteristics[]`), port (`id, code, name, countryCode, coordinate, active`), species (`id, faoCode,
scientificName, commonNames[], localNames[], active`). **Statistical area** uses a GeoJSON `Feature`
  shape, not the flat JSON item shape of the other four types: `{ type: 'Feature', id, properties: { id,
code, name, areaType, parentCode?, parentName?, areaKm2?, centroid? }, geometry }` — only
  `properties.id`/`code`/`name` are consumed by Step 15/16; `areaType`, `parentCode`, `parentName`,
  `areaKm2`, `centroid`, and `geometry` are read-but-unused today (exposed on the client result only if a
  future approved consumer needs them, never invented fields beyond what the schema above confirms).
- **Service-to-service authentication**: `Authorization: Bearer <token>`, validated by the same
  Authentication Service `/validate` contract as Step 13.
- **Timeout / retry**: `referenceData.timeoutMs` (env `REFERENCE_DATA_SERVICE_TIMEOUT_MS`, default `2000`),
  one bounded retry (`referenceData.retryCount` / `REFERENCE_DATA_SERVICE_RETRY_COUNT`, default `1`,
  `referenceData.retryDelayMs` / `REFERENCE_DATA_SERVICE_RETRY_DELAY_MS`, default `100`), retrying only
  transient `502`/`503`/`504` failures — never `4xx`.
- **Config**: `referenceData.baseUrl` (env `REFERENCE_DATA_SERVICE_URL`), alongside the timeout/retry keys
  above.

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

### Species catch-detail attributes — not Reference Data Service concepts

Per `design/architecture/species-property-completion.md`, the per-species catch-detail values
(`weightAboveMinimum`, `weightBelowMinimum`, `weightDiscarded`) are Catch Recording's own captured data,
not Reference Data Service reference data — there is no RDS endpoint for them and none is called. The
canonical `catchDetails[].attributeId` codes are a small fixed, locally-owned catalogue:

| `attributeId` | Meaning              | `nameSnapshot`                         | `unitSnapshot` |
| ------------- | -------------------- | -------------------------------------- | -------------- |
| `LSC`         | `weightAboveMinimum` | Weight Above Minimum Size Kept Onboard | `kg`           |
| `BMS`         | `weightBelowMinimum` | Weight Below Minimum Size Kept Onboard | `kg`           |
| `DIS`         | `weightDiscarded`    | Weight Discarded                       | `kg`           |

`BMS` and `DIS` are placeholder codes approved by the service owner pending any future confirmation; `LSC`
was already given in `canonical-catch-record-object.md`.

## Security and privacy

No credential, token, access key, or secret key is introduced by this step (none was added — there is no
new configuration at all). Nothing in this document reproduces a secret value; the local `floci` S3-
emulator credentials referenced above are the well-known public dummy values used by that local tool, not
a real secret, and are not reproduced here regardless.
