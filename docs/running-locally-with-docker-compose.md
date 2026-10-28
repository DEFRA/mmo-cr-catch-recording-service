# Running Locally with Docker Compose, and Manual Testing with curl

This guide covers starting the Catch Recording Service locally with Docker Compose and exercising it
manually with `curl`. For the full endpoint list see
[`docs/api-endpoints.md`](./api-endpoints.md); for configuration see
[`.env.example`](../.env.example) and `src/config.js`.

## What `compose.yml` starts

| Service                          | Image                                                      | Purpose                                                                                                                                                                                       |
| -------------------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mmo-cr-catch-recording-service` | built from this repo's `Dockerfile` (`development` target) | The API itself, on port `3001`                                                                                                                                                                |
| `mongodb`                        | `mongo:7.0.28`                                             | Operational persistence                                                                                                                                                                       |
| `floci`                          | `hectorvent/floci:latest-aws`                              | Local S3-compatible emulator for immutable submission artifacts. `compose/floci/start.d/10-setup-resources.sh` automatically creates the `mmo-cr-catch-recording-artifacts` bucket on startup |
| `redis`                          | `redis:7.2.3-alpine3.18`                                   | **Not used by this service** — left over from the generic CDP template; the approved Catch Recording architecture has no application cache (verified by `architecture-boundary.test.js`)      |

`compose.yml` already sets `MONGO_URI`, `CATCH_ARTIFACTS_BUCKET`, `CATCH_ARTIFACTS_FORCE_PATH_STYLE`, and
`AWS_ENDPOINT_URL` directly in the service's `environment:` block, plus AWS dummy credentials via
`compose/aws.env` (floci's well-known public test values, not real secrets). It does **not** set
`AUTHENTICATION_SERVICE_URL` or `REFERENCE_DATA_SERVICE_URL`/`REFERENCE_DATA_SERVICE_TOKEN` — see
[Testing authenticated endpoints](#testing-authenticated-endpoints) below for why that matters and how to
add them.

## Prerequisites

- Docker and Docker Compose.
- `curl` (or any HTTP client).
- Optional: a reachable Authentication Service and Reference Data Service (real or mock) if you want to
  exercise anything beyond `/health`/`/example` — see below.

## Starting the service

```bash
docker compose up --build -d
```

Check everything is up:

```bash
docker compose ps
```

Follow the application's logs:

```bash
docker compose logs -f mmo-cr-catch-recording-service
```

Stop everything (add `-v` to also drop the MongoDB data volume):

```bash
docker compose down
```

The service listens on `http://localhost:3001`. Every `curl` example in this guide uses a `CR_URL`
environment variable instead of hard-coding that address, so set it once per shell session:

```bash
export CR_URL=http://localhost:3001
```

## Testing unauthenticated endpoints (works immediately)

These endpoints require no configuration beyond `docker compose up`:

```bash
# Health probe
curl -i "$CR_URL/health"

# Generic example endpoints (skeleton template, not Catch Recording domain)
curl -i "$CR_URL/example"
curl -i "$CR_URL/example/some-id"

# The OpenAPI 3.1 contract for every endpoint in this guide, served live from the running service
curl -i "$CR_URL/openapi.json"
curl -i "$CR_URL/openapi.yaml"
```

Expected: `curl -i "$CR_URL/health"` returns `200` with `{"message":"success"}`.

## Testing authenticated endpoints

Every `/v1/catch-records...` and `/v1/vessels/{vesselId}/...` endpoint requires the trusted
`authentication-service` Hapi strategy (see
[`docs/catch-recording-authentication.md`](./catch-recording-authentication.md)). On every request, the
server extracts your `Authorization: $TOKEN header and calls out to
`AUTHENTICATION_SERVICE_URL` to validate it — it never trusts the token itself.

### Without an Authentication Service configured

By default (plain `docker compose up`), `AUTHENTICATION_SERVICE_URL` is unset, so every authenticated
request fails safely:

```bash
curl -i "$CR_URL/v1/catch-records" \
  -H "Authorization: $TOKEN"
```

Expected: `401` with a safe `AUTHENTICATION_REQUIRED` body — this is correct, documented behaviour, not a
bug (see `docs/catch-recording-known-risks.md`).

### With an Authentication Service and Reference Data Service configured

If you have a mock or real Authentication Service and Reference Data Service reachable on the same Docker
network, wire them in **without editing the committed `compose.yml`** by creating a
`docker-compose.override.yml` (Docker Compose merges this automatically):

```yaml
services:
  mmo-cr-catch-recording-service:
    environment:
      AUTHENTICATION_SERVICE_URL: http://mmo-cr-authentication-service:3001
      REFERENCE_DATA_SERVICE_URL: http://mmo-cr-reference-data-service:3002
      REFERENCE_DATA_SERVICE_TOKEN: local-dev-service-token
    networks:
      - cdp-tenant
```

Join those services to the same external `cdp-tenant` network this repo's `compose.yml` already defines,
then restart:

```bash
docker compose up --build -d
```

Now the full journey can be exercised with `curl`. The variables below are illustrative — substitute
values your configured Authentication Service and Reference Data Service actually accept/recognise:

```bash
export CR_URL=http://localhost:3001
export TOKEN="<TOKEN>"                             # a bearer token your Authentication Service accepts
export VESSEL_ID="<VESSEL_ID>"                      # a vessel ID your Reference Data Service resolves and authorises for $TOKEN
export PORT_ID="<PORT_ID>"                          # an active port GUID known to the Reference Data Service
export GEAR_ID="<GEAR_ID>"                          # an active gear GUID known to the Reference Data Service
export CHARACTERISTIC_ID="<CHARACTERISTIC_ID>"      # a characteristicId belonging to $GEAR_ID
export STATISTICAL_AREA_ID="<STATISTICAL_AREA_ID>"  # a statistical-area id known to the Reference Data Service
export SPECIES_ID="<SPECIES_ID>"                    # an active species GUID known to the Reference Data Service
```

### Catch Record lifecycle

Source: `src/routes/catch-records.js`. Full contracts:
[`docs/canonical-catch-record.md`](./canonical-catch-record.md),
[`docs/catch-recording-lifecycle.md`](./catch-recording-lifecycle.md) and the other
`docs/catch-recording-*.md` files.

```bash
# Create the first persistent DRAFT Catch Record for a vessel.
# Payload: { "vesselId": string, required; "catchRecordReference": string, optional }.
# catchRecordReference, if supplied, must match the approved GBR-{RSS}-{DDMMYY}-{HHMMSS} format and be
# unique - omit it to let the service generate one. Idempotency-Key header is optional.
curl -i -X POST "$CR_URL/v1/catch-records" \
  -H "Authorization: $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d "{\"vesselId\": \"$VESSEL_ID\"}"

# -> capture the returned "id" as CATCH_RECORD_ID and "version" as VERSION
export CATCH_RECORD_ID="<CATCH_RECORD_ID>"
export VERSION=1

# List your own Catch Records (query: limit default 20/max 100, optional status filter)
curl -i "$CR_URL/v1/catch-records?limit=20" \
  -H "Authorization: $TOKEN"

# Retrieve one Catch Record
curl -i "$CR_URL/v1/catch-records/$CATCH_RECORD_ID" \
  -H "Authorization: $TOKEN"

# Combined lifecycle/audit history (query: limit default 20/max 100)
curl -i "$CR_URL/v1/catch-records/$CATCH_RECORD_ID/history?limit=20" \
  -H "Authorization: $TOKEN"
```

#### Saving a section (`PATCH`)

Every `PATCH` requires the current `version` in `If-Match`, and a body shaped
`{ "section": "<name>", "data": <section payload> }` where `<name>` is one of `trip`, `pairFishing`,
`gears`, `speciesNotLanded` (`gears` and `speciesNotLanded` take an array `data`; every other section
takes an object). A successful save returns the updated Catch Record and its new `version`.

```bash
# trip — a complete section object. startedAndFinishedToday:true discards dateStarted/dateEnded
# (server-recomputed); set it to false to supply explicit ISO dates instead.
curl -i -X PATCH "$CR_URL/v1/catch-records/$CATCH_RECORD_ID" \
  -H "Authorization: $TOKEN" \
  -H "Content-Type: application/json" \
  -H "If-Match: $VERSION" \
  -d "{
    \"section\": \"trip\",
    \"data\": {
      \"startedAndFinishedToday\": true,
      \"departurePort\": { \"id\": \"$PORT_ID\" },
      \"returnPort\": { \"id\": \"$PORT_ID\" }
    }
  }"

# pairFishing — enabled:false requires pairVessel/pairSkipperName to be null or absent;
# enabled:true requires both as non-empty strings.
curl -i -X PATCH "$CR_URL/v1/catch-records/$CATCH_RECORD_ID" \
  -H "Authorization: $TOKEN" \
  -H "Content-Type: application/json" \
  -H "If-Match: $VERSION" \
  -d '{
    "section": "pairFishing",
    "data": { "enabled": false, "pairVessel": null, "pairSkipperName": null }
  }'

# gears — an array. Each entry needs gear.id; statisticalArea/characteristics/speciesCaught are optional.
curl -i -X PATCH "$CR_URL/v1/catch-records/$CATCH_RECORD_ID" \
  -H "Authorization: $TOKEN" \
  -H "Content-Type: application/json" \
  -H "If-Match: $VERSION" \
  -d "{
    \"section\": \"gears\",
    \"data\": [
      {
        \"gear\": { \"id\": \"$GEAR_ID\" },
        \"statisticalArea\": { \"id\": \"$STATISTICAL_AREA_ID\" },
        \"characteristics\": [
          { \"characteristicId\": \"$CHARACTERISTIC_ID\", \"value\": 9 }
        ],
        \"speciesCaught\": [
          {
            \"id\": \"$SPECIES_ID\",
            \"weightAboveMinimumKg\": 120.5,
            \"weightBelowMinimumKg\": 4,
            \"weightLegallyDiscardedKg\": null,
            \"weightPrecision\": \"oneDecimalPlace\"
          }
        ]
      }
    ]
  }"

# speciesNotLanded — a root-level, trip-wide array (not tied to any gear).
curl -i -X PATCH "$CR_URL/v1/catch-records/$CATCH_RECORD_ID" \
  -H "Authorization: $TOKEN" \
  -H "Content-Type: application/json" \
  -H "If-Match: $VERSION" \
  -d "{
    \"section\": \"speciesNotLanded\",
    \"data\": [
      {
        \"id\": \"$SPECIES_ID\",
        \"weightAboveMinimumKg\": null,
        \"weightBelowMinimumKg\": 2.5,
        \"weightLegallyDiscardedKg\": null,
        \"weightPrecision\": \"oneDecimalPlace\"
      }
    ]
  }"
```

#### Complete mobile replacement (`PUT`)

`PUT` replaces every client-owned section in one call (max payload 1 MB) — `vessel`, `trip`,
`pairFishing`, `gears`, and `speciesNotLanded` are all required top-level keys, each shaped as above
(`vessel` needs only `{ "id": "<VESSEL_ID>" }`; the Reference Data Service resolves/validates the rest).
Also requires `If-Match`.

```bash
curl -i -X PUT "$CR_URL/v1/catch-records/$CATCH_RECORD_ID" \
  -H "Authorization: $TOKEN" \
  -H "Content-Type: application/json" \
  -H "If-Match: $VERSION" \
  -d "{
    \"vessel\": { \"id\": \"$VESSEL_ID\" },
    \"trip\": {
      \"startedAndFinishedToday\": true,
      \"departurePort\": { \"id\": \"$PORT_ID\" },
      \"returnPort\": { \"id\": \"$PORT_ID\" }
    },
    \"pairFishing\": { \"enabled\": false, \"pairVessel\": null, \"pairSkipperName\": null },
    \"gears\": [
      {
        \"gear\": { \"id\": \"$GEAR_ID\" },
        \"statisticalArea\": { \"id\": \"$STATISTICAL_AREA_ID\" },
        \"characteristics\": [
          { \"characteristicId\": \"$CHARACTERISTIC_ID\", \"value\": 9 }
        ],
        \"speciesCaught\": []
      }
    ],
    \"speciesNotLanded\": []
  }"
```

#### Lifecycle transitions and submission artifacts

```bash
# Submit — generates the immutable JSON snapshot and PDF receipt. Requires If-Match;
# Idempotency-Key is optional (safe to replay with the same key).
curl -i -X POST "$CR_URL/v1/catch-records/$CATCH_RECORD_ID/submission" \
  -H "Authorization: $TOKEN" \
  -H "If-Match: $VERSION" \
  -H "Idempotency-Key: $(uuidgen)"

# List every submission version's artifact metadata (no artifact body)
curl -i "$CR_URL/v1/catch-records/$CATCH_RECORD_ID/submissions" \
  -H "Authorization: $TOKEN"

# Retrieve one immutable artifact body (artifactType is "json" or "pdf") as an attachment download
curl -i "$CR_URL/v1/catch-records/$CATCH_RECORD_ID/submissions/1/json" \
  -H "Authorization: $TOKEN" \
  -o snapshot.json

curl -i "$CR_URL/v1/catch-records/$CATCH_RECORD_ID/submissions/1/pdf" \
  -H "Authorization: $TOKEN" \
  -o receipt.pdf

# Restricted-permission transition SUBMITTED -> COMPLETE. Requires a caller whose authenticated
# permissions include catch-recording.complete. Requires If-Match; Idempotency-Key is optional.
curl -i -X POST "$CR_URL/v1/catch-records/$CATCH_RECORD_ID/completion" \
  -H "Authorization: $TOKEN" \
  -H "If-Match: $VERSION" \
  -H "Idempotency-Key: $(uuidgen)"

# Start an in-place amendment (SUBMITTED/COMPLETE -> DRAFT). Requires If-Match; Idempotency-Key is
# optional. Amendment saves reuse the PATCH route above; resubmission reuses the POST .../submission
# route above.
curl -i -X POST "$CR_URL/v1/catch-records/$CATCH_RECORD_ID/edit-start" \
  -H "Authorization: $TOKEN" \
  -H "If-Match: $VERSION" \
  -H "Idempotency-Key: $(uuidgen)"

# Abandon an eligible, never-submitted DRAFT. Requires If-Match. Returns 204, idempotent.
curl -i -X DELETE "$CR_URL/v1/catch-records/$CATCH_RECORD_ID" \
  -H "Authorization: $TOKEN" \
  -H "If-Match: $VERSION"
```

### Vessel favourites and skippers

Source: `src/routes/vessel-profiles.js`. Full contract:
[`docs/catch-recording-vessel-profiles.md`](./catch-recording-vessel-profiles.md).

```bash
# Favourite gears — list returns { vesselId, favouriteGearIds } (empty array until something is added)
curl -i "$CR_URL/v1/vessels/$VESSEL_ID/favourite-gears" \
  -H "Authorization: $TOKEN"

# Add a favourite gear (gearId must be a valid, active gear in the Reference Data Service)
curl -i -X POST "$CR_URL/v1/vessels/$VESSEL_ID/favourite-gears" \
  -H "Authorization: $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"gearId\": \"$GEAR_ID\"}"

# Remove it again (safe to repeat)
curl -i -X DELETE "$CR_URL/v1/vessels/$VESSEL_ID/favourite-gears/$GEAR_ID" \
  -H "Authorization: $TOKEN"

# Favourite species — same list/add/remove shape, keyed on speciesId
curl -i "$CR_URL/v1/vessels/$VESSEL_ID/favourite-species" \
  -H "Authorization: $TOKEN"

curl -i -X POST "$CR_URL/v1/vessels/$VESSEL_ID/favourite-species" \
  -H "Authorization: $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"speciesId\": \"$SPECIES_ID\"}"

curl -i -X DELETE "$CR_URL/v1/vessels/$VESSEL_ID/favourite-species/$SPECIES_ID" \
  -H "Authorization: $TOKEN"

# Favourite ports — same list/add/remove shape, keyed on portId
curl -i "$CR_URL/v1/vessels/$VESSEL_ID/favourite-ports" \
  -H "Authorization: $TOKEN"

curl -i -X POST "$CR_URL/v1/vessels/$VESSEL_ID/favourite-ports" \
  -H "Authorization: $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"portId\": \"$PORT_ID\"}"

curl -i -X DELETE "$CR_URL/v1/vessels/$VESSEL_ID/favourite-ports/$PORT_ID" \
  -H "Authorization: $TOKEN"

# Vessel-owned skippers — name is required; phoneNumber/email are each optional
curl -i "$CR_URL/v1/vessels/$VESSEL_ID/skippers" \
  -H "Authorization: $TOKEN"

curl -i -X POST "$CR_URL/v1/vessels/$VESSEL_ID/skippers" \
  -H "Authorization: $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "Jane Doe", "phoneNumber": "01234 567890", "email": "jane.doe@example.com"}'

# -> capture the returned skipper's "id" as SKIPPER_ID
curl -i -X DELETE "$CR_URL/v1/vessels/$VESSEL_ID/skippers/<SKIPPER_ID>" \
  -H "Authorization: $TOKEN"
```

See [`docs/catch-recording-vessel-profiles.md`](./catch-recording-vessel-profiles.md) and
[`docs/api-endpoints.md`](./api-endpoints.md) for the full request/response contract of every endpoint.

## Troubleshooting

| Symptom                                                               | Likely cause                                                                     | Check                                                                                                                                                                 |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `curl: (7) Failed to connect to ...` / `$CR_URL` unreachable          | The container isn't up yet, or failed to start, or `$CR_URL` is unset/wrong      | `docker compose ps`, `docker compose logs mmo-cr-catch-recording-service`, `echo $CR_URL`                                                                             |
| `401 AUTHENTICATION_REQUIRED` on every `/v1/...` call                 | `AUTHENTICATION_SERVICE_URL` is unset or unreachable                             | Confirm your override file is applied (`docker compose config` shows the merged environment) and the target service is reachable from inside the `cdp-tenant` network |
| `503 DEPENDENCY_UNAVAILABLE` on draft creation or favourite endpoints | `REFERENCE_DATA_SERVICE_URL`/`REFERENCE_DATA_SERVICE_TOKEN` unset or unreachable | Same as above, for the Reference Data Service                                                                                                                         |
| Artifact/submission errors                                            | The floci S3 emulator isn't healthy yet                                          | `docker compose ps` — the application container has a `depends_on: floci: condition: service_healthy` dependency, so this should be rare                              |
| MongoDB connection errors                                             | MongoDB container not yet accepting connections                                  | `docker compose logs mongodb`                                                                                                                                         |
