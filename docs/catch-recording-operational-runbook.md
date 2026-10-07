# Catch Recording Service — Operational Runbook

> Produced by Phase 9, Step 40 (`design/github-prompts/step-40-complete-release-readiness.md`). Grounded
> only in confirmed repository behaviour (`src/config.js`, `src/server.js`, `src/plugins/`) — it does not
> invent a support rota, escalation contact, or deployment procedure that is not recorded anywhere in this
> repository (see `docs/catch-recording-known-risks.md` for that gap).

## Service summary

Node.js 24 / Hapi 21 backend API, MongoDB 7 persistence, S3-compatible object storage for immutable
submission artifacts (JSON snapshots and PDF receipts). A DEFRA Core Delivery Platform (CDP) service —
deployment infrastructure, container orchestration, and network ingress are owned by the CDP platform, not
by application code in this repository.

## Health and readiness

- `GET /health` — unauthenticated, dependency-free, returns `{ "message": "success" }` with a `200`.
  Intentionally has no MongoDB/Reference-Data-Service/object-storage dependency check, matching the
  mandatory DEFRA constraint that `/health` stay fast and dependency-safe for platform probing.
- No separate `/ready`/`/live` split exists in this repository — `/health` is the only platform probe
  target.

## Configuration reference (`src/config.js`)

All configuration is convict-validated (`strict`) at startup — the process fails fast on an invalid or
missing mandatory value rather than starting in a partially-configured state. Key groups:

| Group                                 | Purpose                                                                                                   | Notes                                                                                                                                                                                                |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `host`/`port`                         | Hapi bind address                                                                                         | —                                                                                                                                                                                                    |
| `mongo.mongoUrl`/`mongo.databaseName` | MongoDB connection                                                                                        | `src/plugins/mongodb.js` creates every required collection index on startup (`ensureCatchRecordIndexes`, `ensureCatchHistoryIndexes`, `ensureCatchIdempotencyIndexes`, `ensureVesselProfileIndexes`) |
| `authentication.*`                    | Authentication Service client (base URL, timeout, bounded retry)                                          | Currently backed by a mock Authentication Service that authorises every request — see `docs/catch-recording-authentication.md`                                                                       |
| `referenceData.*`                     | Reference Data Service client (base URL, service token, timeout, bounded retry)                           | Read-only; the Catch Recording Service never writes to this boundary                                                                                                                                 |
| `catchArtifacts.*`                    | S3-compatible bucket, region, endpoint override (for local emulators), `maxPdfRenderedItems` safety bound | No credential is configured directly — the AWS SDK default credential provider chain is used                                                                                                         |
| `businessTimezone`                    | IANA timezone for every server-controlled business date/time                                              | —                                                                                                                                                                                                    |
| `tracing.header`                      | CDP correlation-ID header name                                                                            | Propagated to the Authentication Service and Reference Data Service on every outbound call                                                                                                           |
| `log.*`                               | pino logging level/format/redaction                                                                       | —                                                                                                                                                                                                    |

## Diagnosing a dependency failure

Every external dependency failure is mapped to a distinct, safe `ApplicationError` category (never a raw
driver/HTTP error) — see `docs/error-handling.md` and `docs/catch-recording-reference-data.md`:

| Symptom (public error code / HTTP status)                  | Likely cause                                                                                                            | First diagnostic step                                                                                                                      |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `AUTHENTICATION_REQUIRED` / 401                            | Authentication Service unreachable, timed out, or rejected the bearer token                                             | Check `authentication.baseUrl` connectivity and the Authentication Service's own health                                                    |
| `DEPENDENCY_UNAVAILABLE` / 503 or `UPSTREAM_TIMEOUT` / 504 | Reference Data Service unreachable or slow                                                                              | Check `referenceData.baseUrl` connectivity; confirm `referenceData.timeoutMs`/`retryCount` are appropriate for current upstream latency    |
| `UPSTREAM_INVALID_RESPONSE` / 502                          | Reference Data Service returned a response that failed strict hand-rolled validation                                    | Inspect the Reference Data Service's own logs/version — this service never relaxes validation to work around a malformed upstream response |
| `ARTIFACT_OPERATION_FAILED` / 500                          | Object-storage (S3-compatible) write/read failure                                                                       | Check `catchArtifacts.bucketName`/`region`/`endpoint` and the bucket's own availability/IAM permissions                                    |
| `VERSION_CONFLICT` / 409                                   | Concurrent update lost the optimistic-concurrency race                                                                  | Expected, recoverable behaviour — instruct the caller to re-fetch and retry with the current version                                       |
| `IDEMPOTENCY_CONFLICT` / 409                               | A reused `Idempotency-Key` was sent with different request content, or a duplicate-prone request is already in progress | Instruct the caller to use a new key for a genuinely different request, or retry after the in-progress request completes                   |

No raw MongoDB, S3, or upstream-HTTP error, stack trace, or internal detail is ever returned to a caller
(`src/plugins/error-mapping.js` is the single central boundary — see `docs/error-handling.md`).

## Recovery behaviour already built in (no manual intervention required)

- **Submission/resubmission retry**: deterministic artifact keys and a check-existing-artifact-first
  strategy mean a retried submission request reuses the already-committed JSON/PDF rather than creating a
  duplicate or inconsistent artifact (`docs/catch-recording-submission.md`).
- **Targeted idempotency**: `Idempotency-Key` (optional, on draft creation, submission, edit-start,
  resubmission, favourite/skipper addition, completion) lets a retried request safely replay its original
  outcome rather than re-executing a duplicate-prone operation.
- **Optimistic concurrency**: every existing-record mutation requires an `If-Match` expected version;
  a stale version is rejected deterministically (`409 VERSION_CONFLICT`), never silently overwritten.

## Logs and correlation

Structured pino logging (ECS format) via `request-logger`/`request-tracing` plugins; every request/response
and outbound dependency call carries the CDP tracing header (`tracing.header`, default
`x-cdp-request-id`) for correlation. Logs never include credentials, tokens, complete Catch Records,
complete skipper payloads, PDF content, or raw dependency responses (see `docs/configuration-decisions.md`
→ "Security and privacy").

## Known operational gaps

See `docs/catch-recording-known-risks.md` for the confirmed gaps (performance targets, retention/
privacy schedule, formal support/escalation model) that this runbook cannot resolve because no
authoritative decision exists anywhere in the repository.
