# Catch Recording Service: Complete Manual `curl` Test Guide

This guide provides runnable examples for all 27 HTTP endpoints exposed by the Catch Recording Service. The payloads use the supplied Catch Record as the example object structure.

> **Important:** The endpoint inventory confirms the routes, authentication requirements, optimistic concurrency via `If-Match`, and lifecycle operations. The exact validation contract for each nested field is defined by the service's canonical Catch Record documentation and Joi schemas. If a local branch expects a slightly different replacement payload, use the `GET` response as the source of truth and remove server-managed fields before sending the `PUT`.

## 1. Start the local service

```bash
docker compose up --build -d
docker compose ps
docker compose logs -f mmo-cr-catch-recording-service
```

The API is available at `http://localhost:3001` by default.

Authenticated `/v1/...` calls require a configured Authentication Service. Operations that validate vessels, ports, gears, species, or related reference values also require a reachable Reference Data Service.

## 2. Set reusable variables

Run this block once in the same shell used for the commands below:

```bash
export BASE_URL="http://localhost:3001"
export TOKEN="replace-with-a-token-accepted-by-authentication-service"

export VESSEL_ID="0fe4d4aa-22f8-449e-89c9-b7052bae8667"
export CATCH_RECORD_ID="5f9c6586-3bf0-4fbb-95d8-ef2cf9c1d9af"
export VERSION="1"
export SUBMISSION_NUMBER="1"

export PORT_ID="462e3de0-8d5e-422a-aaed-220da112ca81"
export GEAR_ID="f3c85f59-1196-43da-b74b-909f7d7be451"
export SPECIES_ID="COD"
export SKIPPER_ID="replace-with-id-returned-by-create-skipper"
```

Optional helper for pretty-printing JSON responses:

```bash
# Pipe a JSON response to jq, for example:
curl -sS "$BASE_URL/health" | jq
```

## 3. Platform and example endpoints

### 3.1 Health check

Expected: `200 OK` with `{"message":"success"}`.

```bash
curl -i -sS "$BASE_URL/health"
```

### 3.2 List generic examples

```bash
curl -i -sS "$BASE_URL/example"
```

### 3.3 Get one generic example

```bash
curl -i -sS "$BASE_URL/example/some-id"
```

## 4. Catch Record workflow

### 4.1 Create a draft Catch Record

Expected: `201 Created`. The service creates the record and returns its generated `id` and current `version`.

```bash
curl -i -sS -X POST "$BASE_URL/v1/catch-records" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: create-catch-record-001" \
  --data-raw "{
    \"vesselId\": \"$VESSEL_ID\"
  }"
```

Create the draft and capture its identifiers automatically when `jq` is installed:

```bash
CREATE_RESPONSE="$(curl -sS -X POST "$BASE_URL/v1/catch-records" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: create-catch-record-$(date +%s)" \
  --data-raw "{\"vesselId\":\"$VESSEL_ID\"}")"

printf '%s\n' "$CREATE_RESPONSE" | jq
export CATCH_RECORD_ID="$(printf '%s' "$CREATE_RESPONSE" | jq -r '.id')"
export VERSION="$(printf '%s' "$CREATE_RESPONSE" | jq -r '.version')"
printf 'CATCH_RECORD_ID=%s\nVERSION=%s\n' "$CATCH_RECORD_ID" "$VERSION"
```

### 4.2 List the caller's Catch Records

```bash
curl -i -sS "$BASE_URL/v1/catch-records" \
  -H "Authorization: Bearer $TOKEN"
```

With status and limit filters:

```bash
curl -i -sS "$BASE_URL/v1/catch-records?status=DRAFT&limit=100" \
  -H "Authorization: Bearer $TOKEN"
```

### 4.3 Retrieve one Catch Record

```bash
curl -i -sS "$BASE_URL/v1/catch-records/$CATCH_RECORD_ID" \
  -H "Authorization: Bearer $TOKEN"
```

Refresh the current version before a write:

```bash
export VERSION="$(curl -sS "$BASE_URL/v1/catch-records/$CATCH_RECORD_ID" \
  -H "Authorization: Bearer $TOKEN" | jq -r '.version')"
echo "Current version: $VERSION"
```

### 4.4 Save the `trip` section

```bash
curl -i -sS -X PATCH "$BASE_URL/v1/catch-records/$CATCH_RECORD_ID" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "If-Match: $VERSION" \
  --data-raw "{
    \"section\": \"trip\",
    \"data\": {
      \"startedAndFinishedToday\": true,
      \"dateStarted\": \"2026-10-05\",
      \"dateEnded\": \"2026-10-05\",
      \"departurePort\": {
        \"id\": \"$PORT_ID\",
        \"codeSnapshot\": \"0349\",
        \"nameSnapshot\": \"Plymouth\"
      },
      \"returnPort\": {
        \"id\": \"$PORT_ID\",
        \"codeSnapshot\": \"0349\",
        \"nameSnapshot\": \"Plymouth\"
      }
    }
  }"
```

After every successful mutation, use the `version` returned by that response for the next `If-Match`, or refresh it with the GET command above.

### 4.5 Save the `pairFishing` section: disabled

```bash
curl -i -sS -X PATCH "$BASE_URL/v1/catch-records/$CATCH_RECORD_ID" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "If-Match: $VERSION" \
  --data-raw '{
    "section": "pairFishing",
    "data": {
      "enabled": false,
      "pairVessel": null,
      "pairSkipperName": null
    }
  }'
```

Example with pair fishing enabled:

```bash
curl -i -sS -X PATCH "$BASE_URL/v1/catch-records/$CATCH_RECORD_ID" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "If-Match: $VERSION" \
  --data-raw '{
    "section": "pairFishing",
    "data": {
      "enabled": true,
      "pairVessel": {
        "id": "11111111-2222-3333-4444-555555555555",
        "rssSnapshot": "RSS654321",
        "nameSnapshot": "PAIR VESSEL",
        "externalMarkSnapshot": "PH456",
        "lengthOverallMetresSnapshot": 9.8
      },
      "pairSkipperName": "Alex Smith"
    }
  }'
```

### 4.6 Save the `gears` section

```bash
curl -i -sS -X PATCH "$BASE_URL/v1/catch-records/$CATCH_RECORD_ID" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "If-Match: $VERSION" \
  --data-raw "{
    \"section\": \"gears\",
    \"data\": [
      {
        \"associationId\": \"b5ca27d2-8e5f-4920-89a5-d4756829b44e\",
        \"gear\": {
          \"id\": \"$GEAR_ID\",
          \"codeSnapshot\": \"TBB\",
          \"nameSnapshot\": \"Beam Trawl\"
        },
        \"characteristics\": [
          {
            \"characteristicId\": \"number-of-times-gear-shot\",
            \"nameSnapshot\": \"Number of Times Gear Shot\",
            \"value\": 2
          },
          {
            \"characteristicId\": \"cb6adafd-ce57-4960-95a8-5d463007e63f\",
            \"nameSnapshot\": \"Mesh Size\",
            \"value\": 9,
            \"unitSnapshot\": \"mm\"
          }
        ],
        \"statisticalArea\": {
          \"id\": \"12639177-7614-4616-83cd-6141ecb83924\",
          \"codeSnapshot\": \"46F45\",
          \"nameSnapshot\": \"ICES 46F45\"
        },
        \"speciesCaught\": [
          {
            \"id\": \"COD\",
            \"faoCodeSnapshot\": \"COD\",
            \"nameSnapshot\": \"Atlantic cod\",
            \"weightAboveMinimumKg\": 120.5,
            \"weightBelowMinimumKg\": 4,
            \"weightLegallyDiscardedKg\": null,
            \"weightPrecision\": \"oneDecimalPlace\"
          },
          {
            \"id\": \"HAD\",
            \"faoCodeSnapshot\": \"HAD\",
            \"nameSnapshot\": \"Haddock\",
            \"weightAboveMinimumKg\": 45,
            \"weightPrecision\": \"wholeNumber\"
          }
        ]
      }
    ]
  }"
```

### 4.7 Save the `speciesNotLanded` section

```bash
curl -i -sS -X PATCH "$BASE_URL/v1/catch-records/$CATCH_RECORD_ID" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "If-Match: $VERSION" \
  --data-raw '{
    "section": "speciesNotLanded",
    "data": [
      {
        "id": "WHG",
        "faoCodeSnapshot": "WHG",
        "nameSnapshot": "Whiting",
        "weightAboveMinimumKg": 6.5,
        "weightPrecision": "oneDecimalPlace"
      }
    ]
  }'
```

### 4.8 Replace all client-owned Catch Record content with `PUT`

The replacement body below intentionally omits server-managed properties such as `id`, `catchRecordReference`, `ownerUserId`, `status`, `version`, submission counters, artifacts, and audit timestamps.

```bash
curl -i -sS -X PUT "$BASE_URL/v1/catch-records/$CATCH_RECORD_ID" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "If-Match: $VERSION" \
  --data-raw "{
    \"schemaVersion\": 1,
    \"vessel\": {
      \"id\": \"$VESSEL_ID\",
      \"rssSnapshot\": \"RSS123456\",
      \"nameSnapshot\": \"EXAMPLE VESSEL\",
      \"externalMarkSnapshot\": \"PH123\",
      \"lengthOverallMetresSnapshot\": 8.74
    },
    \"trip\": {
      \"startedAndFinishedToday\": true,
      \"dateStarted\": \"2026-10-05\",
      \"dateEnded\": \"2026-10-05\",
      \"departurePort\": {
        \"id\": \"$PORT_ID\",
        \"codeSnapshot\": \"0349\",
        \"nameSnapshot\": \"Plymouth\"
      },
      \"returnPort\": {
        \"id\": \"$PORT_ID\",
        \"codeSnapshot\": \"0349\",
        \"nameSnapshot\": \"Plymouth\"
      }
    },
    \"pairFishing\": {
      \"enabled\": false,
      \"pairVessel\": null,
      \"pairSkipperName\": null
    },
    \"gears\": [
      {
        \"associationId\": \"b5ca27d2-8e5f-4920-89a5-d4756829b44e\",
        \"gear\": {
          \"id\": \"$GEAR_ID\",
          \"codeSnapshot\": \"TBB\",
          \"nameSnapshot\": \"Beam Trawl\"
        },
        \"characteristics\": [
          {
            \"characteristicId\": \"number-of-times-gear-shot\",
            \"nameSnapshot\": \"Number of Times Gear Shot\",
            \"value\": 2
          },
          {
            \"characteristicId\": \"cb6adafd-ce57-4960-95a8-5d463007e63f\",
            \"nameSnapshot\": \"Mesh Size\",
            \"value\": 9,
            \"unitSnapshot\": \"mm\"
          }
        ],
        \"statisticalArea\": {
          \"id\": \"12639177-7614-4616-83cd-6141ecb83924\",
          \"codeSnapshot\": \"46F45\",
          \"nameSnapshot\": \"ICES 46F45\"
        },
        \"speciesCaught\": [
          {
            \"id\": \"COD\",
            \"faoCodeSnapshot\": \"COD\",
            \"nameSnapshot\": \"Atlantic cod\",
            \"weightAboveMinimumKg\": 120.5,
            \"weightBelowMinimumKg\": 4,
            \"weightLegallyDiscardedKg\": null,
            \"weightPrecision\": \"oneDecimalPlace\"
          },
          {
            \"id\": \"HAD\",
            \"faoCodeSnapshot\": \"HAD\",
            \"nameSnapshot\": \"Haddock\",
            \"weightAboveMinimumKg\": 45,
            \"weightPrecision\": \"wholeNumber\"
          }
        ]
      }
    ],
    \"speciesNotLanded\": [
      {
        \"id\": \"WHG\",
        \"faoCodeSnapshot\": \"WHG\",
        \"nameSnapshot\": \"Whiting\",
        \"weightAboveMinimumKg\": 6.5,
        \"weightPrecision\": \"oneDecimalPlace\"
      }
    ]
  }"
```

### 4.9 Get Catch Record history

```bash
curl -i -sS "$BASE_URL/v1/catch-records/$CATCH_RECORD_ID/history?limit=100" \
  -H "Authorization: Bearer $TOKEN"
```

### 4.10 Submit the Catch Record

Refresh `VERSION` first. Submission generates an immutable JSON snapshot and a PDF receipt.

```bash
curl -i -sS -X POST "$BASE_URL/v1/catch-records/$CATCH_RECORD_ID/submission" \
  -H "Authorization: Bearer $TOKEN" \
  -H "If-Match: $VERSION" \
  -H "Idempotency-Key: submit-catch-record-001"
```

### 4.11 List submission artifact metadata

```bash
curl -i -sS "$BASE_URL/v1/catch-records/$CATCH_RECORD_ID/submissions" \
  -H "Authorization: Bearer $TOKEN"
```

### 4.12 Download a submitted JSON artifact

```bash
curl -fSsL \
  "$BASE_URL/v1/catch-records/$CATCH_RECORD_ID/submissions/$SUBMISSION_NUMBER/json" \
  -H "Authorization: Bearer $TOKEN" \
  -o "catch-record-$CATCH_RECORD_ID-submission-$SUBMISSION_NUMBER.json"

jq . "catch-record-$CATCH_RECORD_ID-submission-$SUBMISSION_NUMBER.json"
```

To inspect response headers instead of saving the body:

```bash
curl -i -sS \
  "$BASE_URL/v1/catch-records/$CATCH_RECORD_ID/submissions/$SUBMISSION_NUMBER/json" \
  -H "Authorization: Bearer $TOKEN"
```

### 4.13 Download a submitted PDF artifact

```bash
curl -fSsL \
  "$BASE_URL/v1/catch-records/$CATCH_RECORD_ID/submissions/$SUBMISSION_NUMBER/pdf" \
  -H "Authorization: Bearer $TOKEN" \
  -o "catch-record-$CATCH_RECORD_ID-submission-$SUBMISSION_NUMBER.pdf"

file "catch-record-$CATCH_RECORD_ID-submission-$SUBMISSION_NUMBER.pdf"
```

### 4.14 Complete the Catch Record

This is a restricted-permission transition from `SUBMITTED` to `COMPLETE`.

```bash
curl -i -sS -X POST "$BASE_URL/v1/catch-records/$CATCH_RECORD_ID/completion" \
  -H "Authorization: Bearer $TOKEN" \
  -H "If-Match: $VERSION" \
  -H "Idempotency-Key: complete-catch-record-001"
```

### 4.15 Start an amendment

This transitions a `SUBMITTED` or `COMPLETE` record back to `DRAFT` for in-place editing.

```bash
curl -i -sS -X POST "$BASE_URL/v1/catch-records/$CATCH_RECORD_ID/edit-start" \
  -H "Authorization: Bearer $TOKEN" \
  -H "If-Match: $VERSION" \
  -H "Idempotency-Key: amend-catch-record-001"
```

After starting an amendment, reuse the PATCH commands and submit again using the submission endpoint.

### 4.16 Delete an eligible unsubmitted draft

Expected: `204 No Content`. Only use this on an eligible, never-submitted draft that is no longer needed.

```bash
curl -i -sS -X DELETE "$BASE_URL/v1/catch-records/$CATCH_RECORD_ID" \
  -H "Authorization: Bearer $TOKEN" \
  -H "If-Match: $VERSION"
```

## 5. Vessel favourite gears

### 5.1 List favourite gears

```bash
curl -i -sS "$BASE_URL/v1/vessels/$VESSEL_ID/favourite-gears" \
  -H "Authorization: Bearer $TOKEN"
```

### 5.2 Add a favourite gear

```bash
curl -i -sS -X POST "$BASE_URL/v1/vessels/$VESSEL_ID/favourite-gears" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: add-favourite-gear-001" \
  --data-raw "{\"gearId\":\"$GEAR_ID\"}"
```

### 5.3 Remove a favourite gear

```bash
curl -i -sS -X DELETE \
  "$BASE_URL/v1/vessels/$VESSEL_ID/favourite-gears/$GEAR_ID" \
  -H "Authorization: Bearer $TOKEN"
```

## 6. Vessel favourite species

### 6.1 List favourite species

```bash
curl -i -sS "$BASE_URL/v1/vessels/$VESSEL_ID/favourite-species" \
  -H "Authorization: Bearer $TOKEN"
```

### 6.2 Add a favourite species

```bash
curl -i -sS -X POST "$BASE_URL/v1/vessels/$VESSEL_ID/favourite-species" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: add-favourite-species-001" \
  --data-raw "{\"speciesId\":\"$SPECIES_ID\"}"
```

### 6.3 Remove a favourite species

```bash
curl -i -sS -X DELETE \
  "$BASE_URL/v1/vessels/$VESSEL_ID/favourite-species/$SPECIES_ID" \
  -H "Authorization: Bearer $TOKEN"
```

## 7. Vessel favourite ports

### 7.1 List favourite ports

```bash
curl -i -sS "$BASE_URL/v1/vessels/$VESSEL_ID/favourite-ports" \
  -H "Authorization: Bearer $TOKEN"
```

### 7.2 Add a favourite port

```bash
curl -i -sS -X POST "$BASE_URL/v1/vessels/$VESSEL_ID/favourite-ports" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: add-favourite-port-001" \
  --data-raw "{\"portId\":\"$PORT_ID\"}"
```

### 7.3 Remove a favourite port

```bash
curl -i -sS -X DELETE \
  "$BASE_URL/v1/vessels/$VESSEL_ID/favourite-ports/$PORT_ID" \
  -H "Authorization: Bearer $TOKEN"
```

## 8. Vessel-owned skippers

### 8.1 List skippers

```bash
curl -i -sS "$BASE_URL/v1/vessels/$VESSEL_ID/skippers" \
  -H "Authorization: Bearer $TOKEN"
```

### 8.2 Add a skipper

```bash
curl -i -sS -X POST "$BASE_URL/v1/vessels/$VESSEL_ID/skippers" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: add-skipper-001" \
  --data-raw '{
    "name": "Jane Doe",
    "phoneNumber": "01234 567890",
    "email": "jane.doe@example.com"
  }'
```

Create a skipper and capture the first returned skipper ID when `jq` is installed:

```bash
SKIPPER_RESPONSE="$(curl -sS -X POST "$BASE_URL/v1/vessels/$VESSEL_ID/skippers" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: add-skipper-$(date +%s)" \
  --data-raw '{"name":"Jane Doe","phoneNumber":"01234 567890","email":"jane.doe@example.com"}')"

printf '%s\n' "$SKIPPER_RESPONSE" | jq
export SKIPPER_ID="$(printf '%s' "$SKIPPER_RESPONSE" | jq -r '.skippers[] | select(.name == "Jane Doe") | .id' | head -n 1)"
echo "SKIPPER_ID=$SKIPPER_ID"
```

### 8.3 Remove a skipper

```bash
curl -i -sS -X DELETE \
  "$BASE_URL/v1/vessels/$VESSEL_ID/skippers/$SKIPPER_ID" \
  -H "Authorization: Bearer $TOKEN"
```

## 9. Negative and concurrency tests

### Missing bearer token

Expected: `401` with a safe authentication error.

```bash
curl -i -sS "$BASE_URL/v1/catch-records"
```

### Invalid bearer token

```bash
curl -i -sS "$BASE_URL/v1/catch-records" \
  -H "Authorization: Bearer invalid-token"
```

### Missing `If-Match`

```bash
curl -i -sS -X PATCH "$BASE_URL/v1/catch-records/$CATCH_RECORD_ID" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  --data-raw '{
    "section": "pairFishing",
    "data": {"enabled": false, "pairVessel": null, "pairSkipperName": null}
  }'
```

### Stale version

Use an intentionally old version to verify optimistic concurrency handling:

```bash
curl -i -sS -X PATCH "$BASE_URL/v1/catch-records/$CATCH_RECORD_ID" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "If-Match: 1" \
  --data-raw '{
    "section": "pairFishing",
    "data": {"enabled": false, "pairVessel": null, "pairSkipperName": null}
  }'
```

### Unsupported section

```bash
curl -i -sS -X PATCH "$BASE_URL/v1/catch-records/$CATCH_RECORD_ID" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "If-Match: $VERSION" \
  --data-raw '{"section":"unknownSection","data":{}}'
```

### Unknown Catch Record

```bash
curl -i -sS \
  "$BASE_URL/v1/catch-records/00000000-0000-0000-0000-000000000000" \
  -H "Authorization: Bearer $TOKEN"
```

### Invalid artifact type

Only `json` and `pdf` are supported.

```bash
curl -i -sS \
  "$BASE_URL/v1/catch-records/$CATCH_RECORD_ID/submissions/$SUBMISSION_NUMBER/xml" \
  -H "Authorization: Bearer $TOKEN"
```

## 10. Recommended end-to-end order

1. Run the health check.
2. Create a draft and capture `CATCH_RECORD_ID` and `VERSION`.
3. Save `trip`, then refresh `VERSION`.
4. Save `pairFishing`, then refresh `VERSION`.
5. Save `gears`, then refresh `VERSION`.
6. Save `speciesNotLanded`, then refresh `VERSION`.
7. Retrieve the record and inspect its complete state.
8. Inspect history.
9. Submit the record using the latest version.
10. List submission metadata.
11. Download and inspect the JSON and PDF artifacts.
12. If authorised, complete the record.
13. Start an amendment, update one or more sections, and resubmit.
14. Test favourites and skippers independently.
15. Create a separate disposable draft for the DELETE test.

## 11. Common troubleshooting

- **Connection refused on port 3001:** run `docker compose ps` and inspect the application logs.
- **Every `/v1/...` call returns 401:** `AUTHENTICATION_SERVICE_URL` is probably unset or unreachable, or the token is not accepted.
- **Draft creation or favourites return 503:** check `REFERENCE_DATA_SERVICE_URL`, `REFERENCE_DATA_SERVICE_TOKEN`, and network reachability.
- **A write fails after an earlier successful write:** refresh the record and update `VERSION`; each successful mutation can increment it.
- **Submission artifact errors:** confirm the local S3-compatible emulator is healthy.
- **Reference validation errors:** replace the sample vessel, port, gear, species, and statistical-area identifiers with values known to the configured Reference Data Service.
