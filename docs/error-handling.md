# Shared Application Errors and HTTP Error Mapping

> Produced by Phase 1, Step 03
> (`design/github-prompts/step-03-implement-shared-application-errors-and-http-mapping.md`), implementing
> `design/architecture/catch-recording-error-handling.md` exactly. This is a focused reference — see that
> document and [`design/architecture/catch-recording-service-design.md`](../design/architecture/catch-recording-service-design.md)
> §15 for the full authoritative design.

## Purpose

Domain and application code (the Catch Recording modules described in
[`catch-recording-modules.md`](./catch-recording-modules.md)) must be able to raise a stable, safe error
without knowing anything about HTTP, Hapi, or Boom. `ApplicationError` is that framework-neutral
contract. Exactly one Hapi `onPreResponse` extension (`src/plugins/error-mapping.js`) translates it —
and every other error shape the service can produce — into the one safe public HTTP response shape.

```text
Domain or application failure -> ApplicationError -> central onPreResponse mapper -> safe HTTP response
```

## How to raise an application error

```js
import { ApplicationError } from '#/common/helpers/errors/application-error.js'

throw new ApplicationError({
  category: 'RESOURCE_NOT_FOUND', // required, must be one of the approved categories below
  code: 'CATCH_RECORD_NOT_FOUND', // optional; defaults to the category's fallback code
  message: 'Catch record not found', // required, public-safe
  details: [{ path: 'catchRecordId', code: 'NOT_FOUND' }], // optional, sanitised automatically
  cause: originalError, // optional, internal only — never serialised or returned publicly
  meta: { collectionName: 'catch-records' } // optional, internal only — never serialised or returned publicly
})
```

`cause` and `meta` are for internal diagnostics only (e.g. to log alongside the error); they are
non-enumerable so `JSON.stringify`, `Object.keys`, and the HTTP mapper never expose them.

## Approved categories

| Category                       | HTTP status | Fallback code                  |
| ------------------------------ | ----------: | ------------------------------ |
| `INVALID_REQUEST`              |         400 | `INVALID_REQUEST`              |
| `AUTHENTICATION_FAILURE`       |         401 | `AUTHENTICATION_REQUIRED`      |
| `AUTHORISATION_FAILURE`        |         403 | `ACCESS_DENIED`                |
| `RESOURCE_NOT_FOUND`           |         404 | `RESOURCE_NOT_FOUND`           |
| `VERSION_CONFLICT`             |         409 | `VERSION_CONFLICT`             |
| `INVALID_LIFECYCLE_TRANSITION` |         409 | `INVALID_LIFECYCLE_TRANSITION` |
| `DUPLICATE_RESOURCE`           |         409 | `DUPLICATE_RESOURCE`           |
| `IDEMPOTENCY_CONFLICT`         |         409 | `IDEMPOTENCY_CONFLICT`         |
| `BUSINESS_VALIDATION_FAILURE`  |         422 | `BUSINESS_VALIDATION_FAILED`   |
| `UPSTREAM_INVALID_RESPONSE`    |         502 | `UPSTREAM_INVALID_RESPONSE`    |
| `DEPENDENCY_UNAVAILABLE`       |         503 | `DEPENDENCY_UNAVAILABLE`       |
| `UPSTREAM_TIMEOUT`             |         504 | `UPSTREAM_TIMEOUT`             |
| `ARTIFACT_OPERATION_FAILURE`   |         500 | `ARTIFACT_OPERATION_FAILED`    |
| `UNEXPECTED_INTERNAL_FAILURE`  |         500 | `INTERNAL_SERVER_ERROR`        |

This catalogue (`src/common/helpers/errors/error-categories.js`) is exact and must not be extended
without an approved, demonstrated HTTP-semantic need. `code` may override the fallback with a more
specific, stable business code without adding a new category, as long as the HTTP meaning is unchanged.

## Safe public error shape

```json
{
  "statusCode": 404,
  "code": "CATCH_RECORD_NOT_FOUND",
  "message": "Catch record not found",
  "correlationId": "trace-id-if-available",
  "details": [{ "path": "version", "code": "STALE_VERSION" }]
}
```

- `statusCode`, `code`, and `message` are always present.
- `correlationId` is included only when the existing tracing mechanism (`getTraceId()` from
  `@defra/hapi-tracing`, the same one used by `src/plugins/logger-options.js`) provides one.
- `details` is included only when at least one safe detail remains after sanitisation.
- Allowed detail fields only: `path`, `code`, `message`, `min`, `max`, `format`, `allowedValues`
  (`src/common/helpers/errors/sanitise-details.js`). Anything else — raw Joi context, submitted values,
  stack traces, causes, internal metadata — is always omitted, never copied.

## How each error source is mapped (`src/common/helpers/errors/http-error-mapper.js`)

1. **`ApplicationError`** — category resolves the HTTP status; the supplied or fallback code, message,
   and sanitised details are returned as-is.
2. **Joi/Hapi validation failure** — detected via Hapi's own `output.payload.validation` marker; always
   HTTP 400, code `INVALID_REQUEST`, fixed message `The request is invalid.`, and safe details built only
   from each Joi detail's `path` and stable `type` code — never Joi's free-text message or the submitted
   value.
3. **Existing Boom error** — status, safe `output.payload.message`, and headers (including
   `WWW-Authenticate`) are preserved unchanged. A stable code is read from `error.data.code` if a future
   caller supplies one; otherwise a small deterministic status→code table is used, with an unclassified
   `409` mapping to the generic `CONFLICT` code rather than guessing a business category.
4. **Unexpected or malformed error** (including a non-`Error` thrown value, or a mapping failure for any
   reason) — fixed, safe HTTP 500, code `INTERNAL_SERVER_ERROR`, generic message. The original
   message/stack is never exposed.

The mapper never throws: any internal failure while mapping falls back to the same safe 500 response.

## Hapi integration (`src/plugins/error-mapping.js`)

One `onPreResponse` extension, registered once (`once: true`, so a second registration attempt is
silently skipped by Hapi rather than producing a second boundary). Successful responses
(`!response.isBoom`) pass straight through. Every error response is routed through the mapper above, and
only the resulting status, payload, and headers are applied via `h.response(payload).code(statusCode)`.

## Logging

The mapper and plugin do not log anything themselves — existing validation logging
(`src/common/helpers/fail-action.js`) and Hapi/server-level diagnostics for unexpected errors are relied
on, so an error is never logged twice solely because it was mapped.

## Security

- No stack trace, internal cause, metadata, raw Joi context, submitted value, database/object-storage
  error, or internal endpoint ever reaches a public response.
- Detail sanitisation builds new plain objects field-by-field from an explicit allow-list — it never
  spreads or copies an untrusted object, so a crafted detail object cannot inject extra fields.

## Running the focused tests

```bash
npx vitest run src/common/helpers/errors src/plugins/error-mapping.test.js
```

Or as part of the full suite: `npm test`.

## Deferred decisions (not resolved by Step 03)

- The final `409` vs `412` HTTP contract for expected-version conflicts — `VERSION_CONFLICT` stays HTTP
  409 for now.
- Business-specific error codes for operations not implemented yet.
- Authentication and authorisation claim details.
- Exact Reference Data Service and object-storage SDK error translations.
- Submission-recovery behaviour.
- Any additional category without a demonstrated HTTP-semantic need.
