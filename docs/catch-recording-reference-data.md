# Catch Recording Reference Data Service client

> Produced by Phase 4, Step 15
> (`design/github-prompts/step-15-implement-reference-data-service-client.md`). Owned by
> `src/catch-recording/reference-data/`. The underlying decisions are recorded in
> [`docs/configuration-decisions.md`](./configuration-decisions.md) → "Phase 4 decisions (Steps 13-16)".

## Purpose

A bounded, read-only, framework-neutral client for the Reference Data Service — the authoritative source
of vessels, ports, gears, gear characteristics, statistical areas, and species. This module owns outbound
request construction, service authentication, timeout, minimal retry, correlation propagation, HTTP
status interpretation, and strict response validation. It does **not** own active-selection policy,
snapshot mapping into Catch Records, vessel authorisation, or any persistence/business operation — those
are Step 16 and later steps.

## The five operations

`createReferenceDataClient(options)` returns exactly five explicit, read-only functions — no generic
`get(resourceType, id)` method exists:

| Operation                    | Endpoint                                                                                |
| ---------------------------- | --------------------------------------------------------------------------------------- |
| `getVesselById(id)`          | `GET /api/v1/reference-data/vessels/{id}`                                               |
| `getPortById(id)`            | `GET /api/v1/reference-data/ports/{id}`                                                 |
| `getSpeciesById(id)`         | `GET /api/v1/reference-data/species/{id}`                                               |
| `getStatisticalAreaById(id)` | `GET /api/v1/reference-data/map/statistical-areas/{id}` (GeoJSON `Feature`)             |
| `getGearById(id)`            | `GET /api/v1/reference-data/gears?ids={id}&includeInactive=true` (collection, not item) |

`getGearById` uses the collection endpoint, not the item endpoint, because a gear's
`applicableCharacteristics[].characteristicId` only resolves to a name/unit via the collection envelope's
top-level `characteristics[]` catalog, which the item endpoint never returns. The client joins the two
into one resolved, self-contained `characteristics[]` array on its result.

## Request construction

- No `view` query parameter is ever sent — canonical representation only.
- Stable IDs are validated (`stable-id.js`) before any network call: non-empty, bounded length, no path
  separator, `..` traversal segment, or control character — then safely URL-encoded.
- `Authorization: Bearer <referenceData.serviceToken>` — Catch Recording's **own** configured service
  credential, never the inbound caller's bearer token.
- The existing `tracing.header` correlation header is forwarded when available; never a second
  correlation mechanism.

## Timeout, retry, and error mapping

| Condition                            | Outcome                                                                                             |
| ------------------------------------ | --------------------------------------------------------------------------------------------------- |
| Invalid caller input (bad stable ID) | `INVALID_REQUEST` — no network call                                                                 |
| `404`                                | `RESOURCE_NOT_FOUND` (resource-specific safe message, never the raw ID)                             |
| `502`/`503`/`504`                    | Retried up to `referenceData.retryCount` times, `retryDelayMs` apart, then `DEPENDENCY_UNAVAILABLE` |
| Any other non-2xx                    | `UPSTREAM_INVALID_RESPONSE` — never retried                                                         |
| Timeout (`referenceData.timeoutMs`)  | `UPSTREAM_TIMEOUT` — never retried as a transient status                                            |
| Network-level failure                | `DEPENDENCY_UNAVAILABLE` — never retried                                                            |
| Malformed/partial success body       | `UPSTREAM_INVALID_RESPONSE` — never repaired, coerced, or partially accepted                        |

All five reuse the exact existing Step 03 error categories — no new category is introduced.

## Response validation

Every resource module hand-rolls its own explicit, field-by-field validator (no Joi, no generic schema
engine), consistent with the existing `src/catch-recording/validation/` convention of reserving Joi for
Hapi transport validation only. Unknown extra fields are read but never copied into the returned result.

## Configuration

| Key                          | Env                                     | Default |
| ---------------------------- | --------------------------------------- | ------- |
| `referenceData.baseUrl`      | `REFERENCE_DATA_SERVICE_URL`            | `null`  |
| `referenceData.serviceToken` | `REFERENCE_DATA_SERVICE_TOKEN`          | `null`  |
| `referenceData.timeoutMs`    | `REFERENCE_DATA_SERVICE_TIMEOUT_MS`     | `2000`  |
| `referenceData.retryCount`   | `REFERENCE_DATA_SERVICE_RETRY_COUNT`    | `1`     |
| `referenceData.retryDelayMs` | `REFERENCE_DATA_SERVICE_RETRY_DELAY_MS` | `100`   |

## What Step 15 does not do

- Active-selection policy, snapshot mapping, or vessel-access composition — Step 16.
- Species catch-detail attributes (`LSC`/`BMS`/`DIS`) — these are Catch Recording's own small fixed
  catalogue, not a Reference Data Service concept.
- Any mutation (`POST`/`PUT`/`PATCH`/`DELETE`) — this client is strictly read-only.
- Application caching of any kind.
