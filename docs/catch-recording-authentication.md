# Catch Recording trusted authentication context

> Produced by Phase 4, Step 13
> (`design/github-prompts/step-13-implement-trusted-authentication-context.md`). Owned by the
> `CatchRecording Controller` module (`src/catch-recording/controller/`). The underlying decisions are
> recorded in [`docs/configuration-decisions.md`](./configuration-decisions.md) → "Phase 4 decisions
> (Steps 13-16)".

## Purpose

Establish the one trusted identity-extraction boundary used by later Catch Recording operations. This
service does not consume a gateway-injected JWT claim set. Instead it validates the caller's forwarded
bearer token directly against the Authentication Service (currently a mock, always-allow implementation)
and exposes a minimal, framework-neutral context to application code.

## Files

| File                        | Responsibility                                                                                                                                                                     |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `authentication-errors.js`  | One shared `ApplicationError` factory (`AUTHENTICATION_FAILURE`/`AUTHENTICATION_REQUIRED`) reused by the client and the context mapper.                                            |
| `authentication-client.js`  | Framework-neutral bounded HTTP adapter; the only caller of `POST {authentication.baseUrl}/validate`. Owns timeout, bounded retry, response validation, and safe-error translation. |
| `authentication-context.js` | Framework-neutral pure mapper producing the frozen `{ userId, scopes }` context.                                                                                                   |
| `authentication-scheme.js`  | Hapi custom authentication scheme (`authentication-service`). Reads only the `Authorization` header, audits the outcome, and returns the context or a safe authentication failure. |
| `authentication-plugin.js`  | Registers the `authentication-service` scheme and strategy from plugin options. Dormant — no route is enforced in Step 13.                                                         |

## Trust boundary

- The only trusted input is the caller's `Authorization` header, forwarded verbatim (as a bearer token)
  to the Authentication Service. Payload, query, path parameters, and every other header are never used
  to establish identity.
- The Authentication Service's success body, `{ actorId: string, permissions: string[] }`, is the sole
  source of truth. `actorId` becomes `userId`; `permissions` becomes a flat `scopes` list. There is no
  separate "roles" concept.

## Context shape

`request.auth.credentials` (once a route opts in via `options: { auth: 'authentication-service' }`) is a
frozen object: `{ userId: string, scopes: string[] }`. No raw token, claim, email, profile, or session
data is exposed.

## Failure behaviour

A missing/empty bearer token, an unconfigured or unavailable Authentication Service, a non-2xx response,
a timeout, a network error, or a malformed success body are all mapped to the same
`ApplicationError` (category `AUTHENTICATION_FAILURE`, code `AUTHENTICATION_REQUIRED`) via the existing
central Hapi error-mapping boundary (`src/plugins/error-mapping.js`), returning a safe `401` response.
Only `502`/`503`/`504` responses from the Authentication Service are retried, bounded by
`authentication.retryCount`.

## Logging and audit

Authentication outcomes are audited via `@defra/cdp-auditing` with only
`{ event: 'catch_recording.authentication', outcome, code, correlationId }`. The token, `actorId`,
`scopes`, and the raw Authentication Service response are never logged, audited, or returned publicly.

## Configuration

| Key                           | Env                                     | Default | Purpose                                    |
| ----------------------------- | --------------------------------------- | ------- | ------------------------------------------ |
| `authentication.baseUrl`      | `AUTHENTICATION_SERVICE_URL`            | `null`  | Base URL of the Authentication Service     |
| `authentication.timeoutMs`    | `AUTHENTICATION_SERVICE_TIMEOUT_MS`     | `2000`  | Request timeout                            |
| `authentication.retryCount`   | `AUTHENTICATION_SERVICE_RETRY_COUNT`    | `1`     | Bounded retries for `502`/`503`/`504` only |
| `authentication.retryDelayMs` | `AUTHENTICATION_SERVICE_RETRY_DELAY_MS` | `100`   | Delay between bounded retries              |

## What Step 13 does not do

- Resource authorisation (vessel access, Catch Record ownership, completion permission) — Step 14.
- Reference Data Service integration — Step 15.
- Enforcing authentication on any real route — no business route exists yet; later steps opt in.
