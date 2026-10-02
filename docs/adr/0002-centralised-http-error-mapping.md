# 2. Centralise public HTTP error mapping behind a shared application-error contract

Date: 2026-10-02

## Status

Accepted

## Context

The repository currently has no central mechanism for shaping public HTTP error responses. The existing
example route throws `Boom.notFound()` directly, and the shared `failAction`
(`src/common/helpers/fail-action.js`) only logs and rethrows Joi validation failures, relying entirely on
Hapi's and Boom's default payload shape (`{ statusCode, error, message }`).

The approved service design (`design/architecture/catch-recording-service-design.md` §19) requires a
richer, stable public error contract — `statusCode`, `code`, `message`, `correlationId`, optional safe
`details` — applied consistently across every future Catch Recording endpoint, Boom-compatible existing
routes, Joi validation failures, and unexpected internal errors, without leaking stack traces, causes, or
raw dependency data.

Step 02 (ADR 0001) established internal Catch Recording component boundaries and their composition, but
deliberately did not address HTTP error formatting. Introducing a single, repository-wide mechanism that
shapes every error response is a distinct architectural decision — a new response-formatting/error-
handling architecture — and therefore requires its own ADR per the working framework (copilot-instructions
§3, step 6).

Relevant repository facts verified during Step 03 planning:

- Hapi auto-converts (`Boom.boomify`) any thrown, non-Boom error into a Boom-shaped object **in place**
  (mutating the original thrown object, not replacing it) before the `onPreResponse` extension point runs.
  This means a plain `ApplicationError` thrown from a future handler still carries its own properties
  (`category`, `code`, `details`) when inspected in `onPreResponse`, even though Hapi has also bolted on
  `isBoom`/`output` with a default 500 status.
- Boom's own `output.payload.message` is already safe: generic for every 5xx status (never the original
  error message) and the real intended public message for <5xx (e.g. `Boom.notFound()`). This can be
  reused directly rather than reimplemented.
- No existing central Hapi extension or response-formatting mechanism exists to conflict with this
  decision.

### Alternatives considered

1. **Per-route error mapping** (each future route handler catches and formats its own errors). Rejected:
   this duplicates mapping logic across every future Catch Recording route, risks inconsistent payload
   shapes, and does not retrofit the richer contract onto existing Boom-based routes without touching
   them — explicitly against the approved objective of consistent, automatic coverage.
2. **A Boom-subclass hierarchy** (one Boom-derived class per application-error category). Rejected: this
   would force every application/domain boundary that raises an error to import `@hapi/boom`, violating
   the approved layering ("domain and application boundaries do not import Hapi or Boom") and the Step 02
   architecture boundaries. It would also grow into a larger class hierarchy than the approved scope
   permits ("do not create a large class hierarchy if a smaller contract satisfies the requirements").
3. **A second correlation/tracing mechanism dedicated to error responses.** Rejected: the repository
   already has a working, configured tracing mechanism (`@defra/hapi-tracing`, `getTraceId()`); introducing
   a second one would violate "do not create another correlation mechanism" and risk divergent identifiers
   between logs and responses.

## Decision

Introduce one framework-agnostic `ApplicationError` contract (`src/common/helpers/errors/`) and one central
Hapi `onPreResponse` extension, registered as a new plugin (`src/plugins/error-mapping.js`), that rewrites
`request.response.output.statusCode`/`.payload` for every Boom-shaped response (whether it originated as an
`ApplicationError`, a genuine Joi validation failure, an existing `Boom.xxx()` call, or an unexpected
auto-boomified error) into the approved safe public shape. Successful (non-error) responses are returned
unchanged via `h.continue`.

Details:

- `ApplicationError` extends the native `Error`, validates its `category` against a fixed, approved
  catalogue at construction time, and never imports Hapi or Boom — so it is safely usable by any future
  Catch Recording application/domain boundary (Step 02's components) without those boundaries depending on
  the HTTP framework.
- Only the HTTP-boundary module (`http-error-mapper.js`) and the Hapi plugin (`error-mapping.js`) import
  `@hapi/boom`, preserving the approved dependency direction (HTTP adapters → application/domain → ports).
- The mapper is registered once, centrally, and applies automatically to every current and future route —
  no per-route mapping code is needed.
- Correlation IDs are read via the existing `getTraceId()` helper (`@defra/hapi-tracing`); no new
  correlation mechanism, header, or configuration is introduced.

This ADR covers only the error-mapping architecture decision. It does not approve the final shape of any
future Catch Recording error code, business-specific validation detail, authentication/authorisation error
model, or the open `409` vs `412` concurrency-contract decision — those remain for the steps that introduce
them.

## Consequences

### Positive

- Every current and future route gains the richer, safe public error contract automatically, with zero
  per-route code.
- Application and domain code (including all Step 02 Catch Recording boundaries) can raise a stable,
  typed error without ever importing Hapi or Boom.
- Existing Boom-based routes (e.g. the example route's `Boom.notFound()`) keep their exact HTTP status and
  safe message, gaining only the additional `code`/`correlationId` fields — no behavioural regression.
- Unexpected errors are guaranteed a safe, generic 500 response even if the mapping logic itself
  encounters an unexpected shape, because the mapping function is wrapped defensively.

### Negative / Trade-offs

- A new server-wide `onPreResponse` extension adds one more step to the response lifecycle for every
  request. Mitigated by keeping the extension's success-path check (`!response?.isBoom`) a single cheap
  property read before returning `h.continue` unchanged.
- The existing example route's 404 response body gains new fields (`code`, `correlationId`) that were not
  present before. This is an intentional, approved change (no existing test pinned the exact prior payload
  shape), not an unreviewed regression.
- `ApplicationError` instances are deliberately **not** `Object.freeze()`-d (see the architecture document,
  §10) because V8 lazily computes and caches the `.stack` property by redefining it on first access, which
  throws under strict mode (all ES modules) if the instance is already frozen. Only the derived `details`
  and `meta` sub-objects are frozen instead.

### Compliance & Governance

- DEFRA standard(s) referenced: DEFRA security standards (safe, allow-listed public error responses, no
  stack trace/cause/raw-dependency exposure); DEFRA Node.js standards (ES modules, named exports, Hapi
  plugin composition).
- Any governance exception required: None — fully compliant. No authentication, authorisation, or
  persistence technology decision is made here.
