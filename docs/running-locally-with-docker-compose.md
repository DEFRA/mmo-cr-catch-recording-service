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

The service listens on `http://localhost:3001`.

## Testing unauthenticated endpoints (works immediately)

These two endpoints require no configuration beyond `docker compose up`:

```bash
# Health probe
curl -i http://localhost:3001/health

# Generic example endpoints (skeleton template, not Catch Recording domain)
curl -i http://localhost:3001/example
curl -i http://localhost:3001/example/some-id
```

Expected: `curl -i http://localhost:3001/health` returns `200` with `{"message":"success"}`.

## Testing authenticated endpoints

Every `/v1/catch-records...` and `/v1/vessels/{vesselId}/...` endpoint requires the trusted
`authentication-service` Hapi strategy (see
[`docs/catch-recording-authentication.md`](./catch-recording-authentication.md)). On every request, the
server extracts your `Authorization: Bearer <token>` header and calls out to
`AUTHENTICATION_SERVICE_URL` to validate it — it never trusts the token itself.

### Without an Authentication Service configured

By default (plain `docker compose up`), `AUTHENTICATION_SERVICE_URL` is unset, so every authenticated
request fails safely:

```bash
curl -i http://localhost:3001/v1/catch-records \
  -H "Authorization: Bearer any-token"
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

Now the full journey can be exercised with `curl`. Replace `<TOKEN>` with a bearer token your configured
Authentication Service accepts, and `<VESSEL_ID>` with a vessel ID your Reference Data Service recognises
as both existing and accessible to that token's caller.

```bash
TOKEN="<TOKEN>"
VESSEL_ID="<VESSEL_ID>"

# Create the first persistent DRAFT Catch Record for a vessel
curl -i -X POST http://localhost:3001/v1/catch-records \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"vesselId\": \"$VESSEL_ID\"}"

# -> capture the returned "id" as CATCH_RECORD_ID and "version" as VERSION

# List your own Catch Records
curl -i http://localhost:3001/v1/catch-records \
  -H "Authorization: Bearer $TOKEN"

# Retrieve one Catch Record
curl -i http://localhost:3001/v1/catch-records/$CATCH_RECORD_ID \
  -H "Authorization: Bearer $TOKEN"

# Save a section (requires the current version in If-Match)
curl -i -X PATCH http://localhost:3001/v1/catch-records/$CATCH_RECORD_ID \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "If-Match: $VERSION" \
  -d '{"section": "trip", "data": {}}'
```

### Vessel favourites and skippers

```bash
# List favourite ports (returns an empty list until something is added)
curl -i http://localhost:3001/v1/vessels/$VESSEL_ID/favourite-ports \
  -H "Authorization: Bearer $TOKEN"

# Add a favourite port (portId must be a valid, active port in the Reference Data Service)
curl -i -X POST http://localhost:3001/v1/vessels/$VESSEL_ID/favourite-ports \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"portId": "<PORT_ID>"}'

# Remove it again (safe to repeat)
curl -i -X DELETE http://localhost:3001/v1/vessels/$VESSEL_ID/favourite-ports/<PORT_ID> \
  -H "Authorization: Bearer $TOKEN"

# Add a vessel-owned skipper
curl -i -X POST http://localhost:3001/v1/vessels/$VESSEL_ID/skippers \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "Jane Doe", "phoneNumber": "01234 567890"}'
```

See [`docs/catch-recording-vessel-profiles.md`](./catch-recording-vessel-profiles.md) and
[`docs/api-endpoints.md`](./api-endpoints.md) for the full request/response contract of every endpoint.

## Troubleshooting

| Symptom                                                               | Likely cause                                                                     | Check                                                                                                                                                                 |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `curl: (7) Failed to connect to localhost port 3001`                  | The container isn't up yet, or failed to start                                   | `docker compose ps`, `docker compose logs mmo-cr-catch-recording-service`                                                                                             |
| `401 AUTHENTICATION_REQUIRED` on every `/v1/...` call                 | `AUTHENTICATION_SERVICE_URL` is unset or unreachable                             | Confirm your override file is applied (`docker compose config` shows the merged environment) and the target service is reachable from inside the `cdp-tenant` network |
| `503 DEPENDENCY_UNAVAILABLE` on draft creation or favourite endpoints | `REFERENCE_DATA_SERVICE_URL`/`REFERENCE_DATA_SERVICE_TOKEN` unset or unreachable | Same as above, for the Reference Data Service                                                                                                                         |
| Artifact/submission errors                                            | The floci S3 emulator isn't healthy yet                                          | `docker compose ps` — the application container has a `depends_on: floci: condition: service_healthy` dependency, so this should be rare                              |
| MongoDB connection errors                                             | MongoDB container not yet accepting connections                                  | `docker compose logs mongodb`                                                                                                                                         |
