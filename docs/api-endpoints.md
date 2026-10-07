# Catch Recording Service — API Endpoint Reference

> A complete, single-page inventory of every HTTP endpoint currently exposed by this service. For full
> request/response contracts and business rules see the linked per-capability documentation; this
> document is the quick-reference index, not a duplicate of those contracts.

## Conventions used below

- **Auth** — `authentication-service` means the route requires a trusted bearer token (see
  [`docs/catch-recording-authentication.md`](./catch-recording-authentication.md)); `none` means the
  route is unauthenticated.
- **`{param}`** — a path parameter.
- All Catch Recording business endpoints are versioned under `/v1`.
- Every endpoint validates its transport shape with Joi and returns the safe, central error shape
  described in [`docs/error-handling.md`](./error-handling.md) — no raw internal error, stack trace, or
  dependency response is ever returned.

---

## Platform

| Method | Path      | Auth | Description                                                                         |
| :----- | :-------- | :--- | :---------------------------------------------------------------------------------- |
| GET    | `/health` | none | Fast, dependency-free liveness/readiness probe. Returns `{ "message": "success" }`. |

## Generic service skeleton (example — not Catch Recording domain)

| Method | Path                   | Auth | Description                                            |
| :----- | :--------------------- | :--- | :----------------------------------------------------- |
| GET    | `/example`             | none | Lists example data from the generic skeleton template. |
| GET    | `/example/{exampleId}` | none | Retrieves one example record by id, or `404`.          |

---

## Catch Records

Source: `src/routes/catch-records.js`. See
[`docs/canonical-catch-record.md`](./canonical-catch-record.md),
[`docs/catch-recording-lifecycle.md`](./catch-recording-lifecycle.md) and the other
`docs/catch-recording-*.md` files for full contracts.

### Commands (create, mutate, lifecycle transitions)

| Method | Path                                           | Auth                   | Description                                                                                                                                                                                                                 |
| :----- | :--------------------------------------------- | :--------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/v1/catch-records`                            | authentication-service | Creates the first persistent `DRAFT` Catch Record for a vessel. Optional `Idempotency-Key` header. Returns `201`.                                                                                                           |
| PUT    | `/v1/catch-records/{catchRecordId}`            | authentication-service | Complete mobile replacement of client-owned content. Requires `If-Match` (expected version). Max payload 1 MB.                                                                                                              |
| PATCH  | `/v1/catch-records/{catchRecordId}`            | authentication-service | Generic section save — one of `trip`, `pairFishing`, `gears`, `speciesNotLanded`. Requires `If-Match`.                                                                                                                      |
| DELETE | `/v1/catch-records/{catchRecordId}`            | authentication-service | Abandons an eligible, never-submitted `DRAFT`. Requires `If-Match`. Returns `204`, idempotent.                                                                                                                              |
| POST   | `/v1/catch-records/{catchRecordId}/submission` | authentication-service | Submits the Catch Record — generates the immutable JSON snapshot and PDF receipt. Requires `If-Match`; optional `Idempotency-Key`.                                                                                          |
| POST   | `/v1/catch-records/{catchRecordId}/completion` | authentication-service | Restricted-permission transition `SUBMITTED → COMPLETE`. Requires `If-Match`; optional `Idempotency-Key`.                                                                                                                   |
| POST   | `/v1/catch-records/{catchRecordId}/edit-start` | authentication-service | Starts an in-place amendment (`SUBMITTED`/`COMPLETE` → `DRAFT`). Requires `If-Match`; optional `Idempotency-Key`. Amendment saves reuse the `PATCH` route above; resubmission reuses the `POST .../submission` route above. |

### Queries

| Method | Path                                                                              | Auth                   | Description                                                                                                           |
| :----- | :-------------------------------------------------------------------------------- | :--------------------- | :-------------------------------------------------------------------------------------------------------------------- |
| GET    | `/v1/catch-records`                                                               | authentication-service | Owner-scoped, bounded listing. Query: `limit` (default 20, max 100), optional `status` filter.                        |
| GET    | `/v1/catch-records/{catchRecordId}`                                               | authentication-service | Complete retrieval with derived display status and domain-progress facts.                                             |
| GET    | `/v1/catch-records/{catchRecordId}/history`                                       | authentication-service | Combined lifecycle/audit history, bounded and deterministically ordered. Query: `limit` (default 20, max 100).        |
| GET    | `/v1/catch-records/{catchRecordId}/submissions`                                   | authentication-service | Lists every submission version's artifact metadata (no artifact body).                                                |
| GET    | `/v1/catch-records/{catchRecordId}/submissions/{submissionNumber}/{artifactType}` | authentication-service | Retrieves one immutable artifact body. `artifactType` is `json` or `pdf`. Returns the file as an attachment download. |

---

## Vessel Favourites and Skippers

Source: `src/routes/vessel-profiles.js`. Full contract:
[`docs/catch-recording-vessel-profiles.md`](./catch-recording-vessel-profiles.md).

### Favourite gears

| Method | Path                                              | Auth                   | Description                                                                                                                                      |
| :----- | :------------------------------------------------ | :--------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/v1/vessels/{vesselId}/favourite-gears`          | authentication-service | Returns `{ vesselId, favouriteGearIds }` (empty array if none yet).                                                                              |
| POST   | `/v1/vessels/{vesselId}/favourite-gears`          | authentication-service | Payload `{ gearId }`. Validates against the Reference Data Service. Idempotent; optional `Idempotency-Key`. Returns `200` with the updated list. |
| DELETE | `/v1/vessels/{vesselId}/favourite-gears/{gearId}` | authentication-service | Removes the favourite. Safe to repeat. Returns `204`.                                                                                            |

### Favourite species

| Method | Path                                                   | Auth                   | Description                                                                        |
| :----- | :----------------------------------------------------- | :--------------------- | :--------------------------------------------------------------------------------- |
| GET    | `/v1/vessels/{vesselId}/favourite-species`             | authentication-service | Returns `{ vesselId, favouriteSpeciesIds }`.                                       |
| POST   | `/v1/vessels/{vesselId}/favourite-species`             | authentication-service | Payload `{ speciesId }`. Same validation/idempotency behaviour as favourite gears. |
| DELETE | `/v1/vessels/{vesselId}/favourite-species/{speciesId}` | authentication-service | Removes the favourite. Safe to repeat. Returns `204`.                              |

### Favourite ports

| Method | Path                                              | Auth                   | Description                                                                     |
| :----- | :------------------------------------------------ | :--------------------- | :------------------------------------------------------------------------------ |
| GET    | `/v1/vessels/{vesselId}/favourite-ports`          | authentication-service | Returns `{ vesselId, favouritePortIds }`.                                       |
| POST   | `/v1/vessels/{vesselId}/favourite-ports`          | authentication-service | Payload `{ portId }`. Same validation/idempotency behaviour as favourite gears. |
| DELETE | `/v1/vessels/{vesselId}/favourite-ports/{portId}` | authentication-service | Removes the favourite. Safe to repeat. Returns `204`.                           |

### Vessel-owned skippers

| Method | Path                                          | Auth                   | Description                                                                                                                                                                                  |
| :----- | :-------------------------------------------- | :--------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/v1/vessels/{vesselId}/skippers`             | authentication-service | Returns `{ vesselId, skippers: [{ id, name, phoneNumber, email }] }`.                                                                                                                        |
| POST   | `/v1/vessels/{vesselId}/skippers`             | authentication-service | Payload `{ name, phoneNumber?, email? }`. Server-generates `id`. Idempotent for a case-insensitive, trimmed duplicate name; optional `Idempotency-Key`. Returns `200` with the updated list. |
| DELETE | `/v1/vessels/{vesselId}/skippers/{skipperId}` | authentication-service | Removes the skipper. Safe to repeat. Returns `204`. No update endpoint exists (deferred — no confirmed UI requirement).                                                                      |

---

## Endpoint count summary

```text
Platform:                     1  (GET /health)
Generic skeleton (example):   2
Catch Records commands:       7
Catch Records queries:        5
Vessel favourites:            9  (3 resource types x list/add/remove)
Vessel skippers:              3
-----------------------------------
Total:                        27
```
