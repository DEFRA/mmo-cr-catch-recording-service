# Entra External ID authentication and authorization

> Implements the approved design in `design/architecture/final-entra-external-id-authentication-and-authorization-design.md`.
> This document grows with each implementation step; sections state what is implemented **now**. The
> legacy Authentication Service flow described in
> [`catch-recording-authentication.md`](./catch-recording-authentication.md) remains the runtime
> authentication until the legacy removal step. Configuration is documented in
> [`configuration-decisions.md`](./configuration-decisions.md).

## OIDC metadata and signing keys (Step 02)

Entra signs access tokens; this service verifies them locally with Entra's public keys. Step 02 only
obtains and caches those keys — **no bearer token is validated yet**.

Code: `src/authentication/entra/` and the `entraSigningKeys` plugin (`src/plugins/entra-signing-keys.js`),
which decorates the server with `server.entraSigningKeyProvider` (`null` when Entra is not configured,
which is only permitted for local development).

| File                      | Responsibility                                                                                                                                                           |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `bounded-json-fetch.js`   | One GET with a bounded timeout and body size; redirects are never followed; every failure is mapped to a safe `SigningKeyError`.                                         |
| `oidc-metadata-client.js` | Reads the discovery document from the configured `entra.oidcMetadataUrl` only; requires the `issuer` to equal `entra.issuer` exactly.                                    |
| `jwks-client.js`          | Reads the JWKS from the validated `jwks_uri` only and builds verification keys with `jose` (no hand-written cryptography).                                               |
| `signing-key-provider.js` | Immutable snapshot, exact-`kid` lookup, single-flight throttled refresh, atomic replacement.                                                                             |
| `signing-key-failure.js`  | Typed, HTTP-independent failure reasons (metadata/JWKS unavailable or invalid, issuer mismatch, no usable keys, key not found, throttled, timeout, cancelled, internal). |

Behaviour:

- **Trust boundary.** The JWKS URL comes only from successfully validated metadata fetched from the
  configured URL — never from a token, claim or header. It must be `https` (an `http` `jwks_uri` is accepted
  only for local development).
- **Accepted keys.** RSA public keys with a unique, non-empty `kid`, `use` `sig` (or absent), an allowed
  `alg` (or absent), `verify` key operations (or absent), a plausible exponent and a modulus of at least
  2048 bits, and no private members. Anything else is ignored and never used as a fallback; a duplicate
  `kid`, an oversized or malformed document is rejected whole. A response yielding no usable key never
  replaces the current snapshot. Limits: 64 KiB metadata, 256 KiB JWKS, 20 keys.
- **Lazy load.** Nothing is fetched at startup, so `/health` and public routes never depend on Entra.
- **Refresh.** A snapshot older than `entra.metadataRefreshIntervalSeconds` is refreshed on the next lookup.
  An unknown `kid` triggers exactly one refresh followed by exactly one retry of the same lookup. Attempts
  are at least `entra.minimumRefreshIntervalSeconds` apart (a throttled lookup returns `REFRESH_THROTTLED`,
  so repeated unknown `kid` values cannot cause a refresh storm), and concurrent callers share the one
  in-flight refresh. A cancelled caller stops waiting without cancelling the shared refresh.
- **Failure.** A failed or invalid refresh keeps the previous valid snapshot and never extends its due
  time, so the next lookup after the minimum interval tries again. With no snapshot, every lookup returns
  the failure reason.
- **Atomicity.** A candidate snapshot is fully built and validated before it replaces the active one.
- **Privacy.** Failures carry fixed reasons only: no URL, response body, header, key material or token is
  logged or exposed.
- **Dependency.** `jose` (named in the approved design §8.3) is the only added dependency.

Deferred: bearer-token validation (Step 03), the authenticated-user context (Step 04) and mapping of the
failure reasons to `401`/`503` (Step 12).

## Bearer access-token validation (Step 03)

Code: `src/authentication/entra/` (`bearer-token.js`, `access-token-validator.js`,
`entra-authentication-scheme.js`) and the `entraAuthentication` plugin
(`src/plugins/entra-authentication.js`), which registers the Hapi strategy `entra-bearer`.

- **Where the token comes from.** Only the standard `Authorization: Bearer <token>` header. A missing,
  empty, repeated, malformed or non-Bearer header is rejected; the credential is read byte-for-byte and
  is never taken from a query string, body, cookie or custom header.
- **Validation is local**, with `jose` (no hand-written cryptography). Before any key lookup only the
  protected header's `alg` (must be in `entra.allowedAlgorithms`, so `none`, symmetric and other
  algorithms are rejected) and non-empty `kid` are read. The key comes **only** from the Step 02 signing
  key provider; `jku`, `x5u` and other token-supplied key locations are ignored and no fallback key is
  ever chosen.
- **Enforced.** Signature, exact `iss` (`entra.issuer`), exact `aud` (`entra.audience`; a multi-valued
  `aud` passes only if it contains that value), `exp` (required), `nbf` (when present). Substring,
  case-folded, wildcard and alias matches are rejected. A token for another API, an ID token or one for
  another environment fails on audience/issuer.
- **Clock skew** is explicit and strict: `0` seconds (the validator accepts an injectable tolerance and
  clock). Entra does not currently define a tolerance for this service; see the open items below.
- **Token version.** The approved design does not prescribe a `ver` check, so none is invented; the exact
  issuer (which carries the `/v2.0` path for v2 tokens) is the version binding.
- **Result.** Success returns a deep-frozen claims object only after every check passes; failure returns
  `{ ok: false, reason, source }` where `source` is `credentials`, `dependency` (signing keys
  unavailable, or Entra not configured) or `internal`. Neither contains the token or any claim.
- **Claim isolation.** Claims are never attached to the request. The `entra-bearer` strategy
  authenticates with an empty credentials object: no user identity exists until the trusted
  authenticated-user context is added (Step 04). A failure stops the request with the existing generic
  `401 AUTHENTICATION_REQUIRED`; the reason stays in the internal `cause`.
- **Not logged.** Tokens, headers and claim sets are never logged by this code.
- **Shared state.** One validator per server reuses the shared provider; the validator holds no
  per-request state.
- **Dormant.** No route uses `entra-bearer` yet and the legacy `authentication-service` strategy is
  untouched; fixed mock-token removal is Step 14. When Entra is not configured (local only) every token is
  rejected - there is no fallback.

Deferred: user identity (Step 04), `503` for key-dependency failures and the final `401` challenge
(Step 12), telemetry (Step 13).

Open item for the Identity/DevOps owners: confirm whether a bounded clock tolerance is required.

## Trusted authenticated-user context (Step 04)

Code: `src/authentication/entra/authenticated-user-context.js`; wired into the `entra-bearer` strategy
(`entra-authentication-scheme.js`).

Request pipeline: read the bearer credential, validate the token completely (Step 03), extract the single
configured identity claim, create the context, and only then continue. A failure at any stage stops the
request with the generic `401 AUTHENTICATION_REQUIRED`; a failed request has no context.

- **One claim, no fallback.** Exactly `entra.userIdClaim` is read (own property of the validated claims
  only). `oid`, `sub`, `email`, `preferred_username` and similar are never substituted or combined.
- **Rejected:** missing, `null`, non-string (number, boolean, object), array (including single-element
  and multi-valued), empty, whitespace-only, padded, over-long (more than 128 characters) or containing
  anything outside `A-Z a-z 0-9 . _ ~ -` (so no control characters, spaces, path separators or percent
  escapes can reach the User Profile Service URL).
- **Opaque identifier.** The approved design leaves the claim configurable (`oid` is a GUID, `sub` is an
  opaque string) and the mock User Profile Service uses non-GUID identifiers, so no GUID constraint is
  imposed and the value is preserved exactly (no case folding). Assumption recorded; confirm the final
  claim with the Identity/DevOps owners.
- **Context.** `Object.freeze({ userId })` - no token, claims, roles, scopes, capabilities, e-mail, name
  or profile data. It is the request's Hapi credentials, so it is request-scoped (no module-level
  "current user"); concurrent requests cannot observe each other's identity.
- **Accessor.** Downstream code calls `getAuthenticatedUser(request)`. It returns the context only for a
  request authenticated by `entra-bearer` with a context created by this module, and `null` otherwise -
  so a legacy `authentication-service` principal, or any look-alike object, never satisfies it. It never
  reads a body, query, route parameter, header or cookie, so request data cannot override the caller.
- **Transition.** The legacy strategy is unchanged and no route uses `entra-bearer` yet; there is no
  fallback from a failed Entra authentication to a mock identity. Step 05 will use `userId` to build the
  user-roles request; roles, caching and capabilities are not part of this step.

## User Profile Service client (Step 05)

Code: `src/authorization/user-profile-client.js`; registered once by the `userProfile` plugin
(`src/plugins/user-profile-client.js`) as `server.userProfileClient` (`null` only when authorization is
entirely unconfigured in local development). It is not yet used by any request path.

It supports exactly two reads and nothing else (no arbitrary-path client):

| Operation                  | Request                      | Source of the variable part                                                      |
| -------------------------- | ---------------------------- | -------------------------------------------------------------------------------- |
| `getUserRoles(user, opts)` | `GET {userRolesUrlTemplate}` | `user.userId` from the trusted Step 04 context, as one encoded path segment      |
| `getRoleDefinitions(opts)` | `GET {roleDefinitionsUrl}`   | the validated configuration (its path already carries `authorization.serviceId`) |

- **Trusted identity only.** `getUserRoles` accepts only a context created by Step 04; any other value
  (including a look-alike object or a string) is refused before a request is built. Path, query, body and
  header values can never replace the origin or the identifier.
- **No credentials.** Only `Accept: application/json` and the correlation header are sent. The incoming
  Entra access token is never forwarded; there is no API key, secret, managed identity, mTLS or signed
  request. The current User Profile Service is an unauthenticated mock; **production service-to-service
  authentication remains a deferred production requirement**.
- **Correlation.** The caller-supplied correlation id is sent in the configured tracing header
  (`tracing.header`, `x-cdp-request-id`) only if it is a safe token (1-128 of `A-Za-z0-9._-`).
- **Timeout / cancellation.** `authorization.userProfileRequestTimeoutMs` bounds every attempt; a caller
  `AbortSignal` is honoured independently, so `TIMEOUT` and `CANCELLED` are distinct outcomes.
- **Retry.** The repository's existing approved policy: only HTTP `502`/`503`/`504`, at most
  `authorization.userProfileRetryCount` retries, `authorization.userProfileRetryDelayMs` apart. Timeouts,
  other statuses and invalid content are never retried, so total time stays bounded.
- **Response handling.** `200` with a JSON content type and a body of at most 256 KiB yields
  `{ ok: true, body }` where `body` is the parsed, deeply frozen, **untrusted** JSON. Otherwise
  `{ ok: false, outcome, status }` with one of `NOT_FOUND`, `CLIENT_ERROR`, `RATE_LIMITED`,
  `SERVER_ERROR`, `UNAVAILABLE`, `UNEXPECTED_STATUS`, `UNEXPECTED_CONTENT_TYPE`, `INVALID_JSON`,
  `TIMEOUT`, `CANCELLED`, `TRANSPORT_FAILURE`, `INTERNAL_ERROR`. These are transport facts, not
  authorisation decisions (a `404` is not a `403`; nothing grants access) and are not mapped to HTTP
  statuses here. Redirects are never followed.
- **Logging.** Safe fields only (operation, outcome, status, duration, attempt). No user identifier, URL,
  body, role or token is logged.
- **Not done here:** semantic validation of the bodies (Step 06), caching (Steps 07-08), capability
  decisions (Step 09).

## Authorization response validation (Step 06)

Code: `src/authorization/authorization-response-validator.js`. It turns an untrusted Step 05 transport
result into an immutable internal model, or a typed failure. Nothing is cached, retried or decided here.

- `validateUserRolesResult(transportResult, trustedUser)` -> `{ userId, definitionsVersion, roleIds }`
- `validateRoleDefinitionsResult(transportResult, serviceId)` -> `{ serviceId, definitionsVersion,
updatedAt, roles: [{ roleId, capabilityIds }] }`

Results are `{ ok: true, value }`, `{ ok: false, source: 'dependency', outcome, status }` (a Step 05
transport failure, passed through untouched - validation never pretends to have happened) or
`{ ok: false, source: 'validation', reason }`. A model exists only after complete validation, is deeply
frozen, and copies nothing from the transport object (extra fields are ignored, not retained).

Validated (the first problem rejects the whole response; nothing is coerced, trimmed, de-duplicated or
silently dropped):

- `schemaVersion`: string, exactly in the allow-list `['1.0']` (no newer or numeric version).
- User roles: `userId` must equal the trusted requested identifier exactly (case-sensitive); `roles` is a
  unique array of valid identifiers. A response for another user is rejected.
- Role definitions: `serviceId` must equal the configured `authorization.serviceId`; `roles` is a
  non-empty array of `{ roleId, capabilityIds }` with unique role ids and unique capability ids per role.
- `definitionsVersion`: required string, up to 64 characters of `A-Za-z0-9._-`, starting alphanumeric.
- `updatedAt`: optional; when present a strict UTC instant (`...Z`, real calendar date), normalised to ISO.
  It is metadata only and is never used for local cache timing.
- Identifiers (roles, capabilities): up to 128 characters of `A-Za-z0-9._:-`, starting alphanumeric - this
  accepts values such as `VRO5--Owner` and `catch-record.read` while rejecting whitespace, control
  characters, separators and wildcards. The capability catalogue is not hard-coded here.
- Bounds: 1000 user roles, 200 role definitions, 100 capabilities per role, 2000 role-capability
  associations in total.

Decisions recorded:

- **Unknown user / no roles.** The approved contract returns `200` with `roles: []` for an unknown user, so
  that is a valid outcome with an empty `roleIds` (no default role, never unrestricted). A transport
  `404` is **not** treated as an unknown user: it stays a dependency failure.
- **Empty role definitions.** Design 7.3 says an empty set grants nothing; design 8.8 says an unexpectedly
  empty body must never replace a valid cache. The conservative reconciliation: an empty `roles`
  collection is rejected as `EMPTY_ROLE_DEFINITIONS` (never usable), so it can neither replace a snapshot
  nor be mistaken for allow-all. A role with an empty `capabilityIds` list is valid and grants nothing.
- Limits are conservative initial values (the design defines none); user roles are bounded generously
  because they can be vessel-scoped.

Open item for Step 09: the design's examples show assigned roles such as `VRO5--Owner` while definitions
list `Owner`; how an assigned role id is matched to a definition is a Step 09 concern and is resolved there.

## User-role cache (Step 07)

Code: `src/authorization/user-role-cache.js`; registered once by the `userRoleCache` plugin
(`src/plugins/user-role-cache.js`) as `server.userRoleCache` (`null` only when authorization is unconfigured
in local development; cleared on server stop). It is not yet used by any request path.

`getUserRoles(user, { correlationId, signal })` returns `{ ok: true, value, cacheState: 'hit' | 'refreshed' }`
or the typed failure of the stage that failed: `{ source: 'dependency' }` (Step 05), `{ source:
'validation' }` (Step 06) or `{ source: 'cache', reason }` (an untrusted user context or an unexpected
error). Failures are never cached and never become an empty role set.

- **Key and value.** Keyed only by the trusted stable user identifier. A cache entry holds only the Step
  06 validated, frozen model (`userId`, `roleIds`, `definitionsVersion`) plus local load and expiry times.
  No token, claim, DTO, JSON, header, response object, capability or role definition is stored.
- **TTL.** `expiresAt` = successful refresh time + `authorization.userRoleCacheTtlSeconds` (initially
  `300`), measured on a monotonic clock. **Fresh while `now < expiresAt`; expired from `now >= expiresAt`.**
  A role removal therefore takes effect no later than the TTL after the last successful retrieval (plus any
  request already in progress).
- **No stale use.** An expired entry is never returned - not even when the refresh fails - and a failed
  refresh never extends it. There is no maximum-stale period for user roles (that belongs to role
  definitions, Step 08). Refresh failure with no usable entry is returned as a failure; Step 12 will map it.
- **No-role users.** A valid response with no roles (how the contract represents an unknown user) is
  cached for the normal TTL and yields an empty `roleIds`, never a default role.
- **Single-flight.** Concurrent lookups for one user share one refresh; different users refresh
  independently and no lock is held across I/O. A caller that cancels stops waiting without cancelling the
  shared refresh. Coordination state is released on success, failure and exception and is bounded by the
  number of in-flight users.
- **Atomic publication and ordering.** A complete validated entry replaces the previous one in a single
  operation; an older refresh result never replaces a newer entry.
- **Capacity.** At most `authorization.userRoleCacheMaximumEntries` users. When full, expired entries are
  removed first, then the least recently used entry (a hit counts as use). No per-entry timers or
  background scanning.
- **Process-local.** Each instance has its own cache, so roles may differ between instances for up to the
  TTL, and a restart empties it. There is no distributed cache.
- **Logging.** Debug events (hit, miss, expired, refresh started/succeeded/failed/coalesced, inserted,
  replaced, evicted, capacity reached) carry no user identifier, role, token or response body; metrics are
  part of Step 13.

## Role-definition cache (Step 08)

Code: `src/authorization/role-definitions-cache.js`; registered once by the `roleDefinitionsCache` plugin
(`src/plugins/role-definitions-cache.js`) as `server.roleDefinitionsCache` (`null` only when authorization
is unconfigured in local development; cleared on server stop). It is a separate cache from the user-role
cache and is not yet used by any request path.

It holds **one** immutable snapshot for `authorization.serviceId`: the Step 06 validated definitions plus
local timing. No user, token, user-role assignment, DTO, JSON or HTTP object is stored, and no
caller-supplied service identifier is accepted.

Timing is local and monotonic, measured from the successful load (`downstream updatedAt` is metadata only):

```text
freshUntil        = loadedAt + authorization.roleDefinitionsCacheTtlSeconds
maximumStaleUntil = freshUntil + authorization.roleDefinitionsCacheMaximumStaleSeconds   (additional window)

fresh       now <  freshUntil
stale       freshUntil <= now < maximumStaleUntil
over-stale  now >= maximumStaleUntil   (never usable)
```

`getRoleDefinitions({ correlationId, signal })`:

| Held snapshot | Behaviour                                                                                                                                                             |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| absent        | single-flight load; success -> `loaded`; failure -> `{ ok: false, snapshotState: 'absent' }`                                                                          |
| fresh         | returned without a request (`hit`); reading never extends a lifetime                                                                                                  |
| stale         | refresh; success -> `refreshed`; failure -> the previous snapshot with `cacheState: 'stale-used'`, `freshness: 'stale'` and a safe `refreshFailure`, timing unchanged |
| over-stale    | refresh; success -> `refreshed`; failure -> `{ ok: false, snapshotState: 'over-stale' }` - the old snapshot is not returned                                           |

- Success is `{ ok: true, snapshot, freshness, cacheState }`; failures keep the Step 05/06 typed shape
  (`source: 'dependency' | 'validation' | 'cache'`) and are never turned into an empty or permissive map.
  The staleness of the previous snapshot is re-evaluated after the refresh returns, so a slow refresh can
  never yield a snapshot past its boundary.
- **Never replaced by bad data.** Dependency errors, invalid or mismatched content, an unsupported schema
  and empty definitions (rejected by Step 06) neither replace nor clear a valid snapshot. An older result
  never overwrites a newer snapshot; publication is one atomic assignment of a complete frozen snapshot.
- **Single-flight.** There is one service-level refresh shared by every concurrent caller (initial, stale
  and over-stale); a cancelled caller stops waiting without cancelling it; coordination state is always
  released so a failure never blocks a later attempt.
- **Startup.** After the server starts, one best-effort load is attempted through the same refresh
  operation; it is not awaited, never prevents startup and never blocks `/health`. If it fails, no snapshot
  exists and authorization stays unavailable until a lazy load succeeds (fail closed).
- **Refresh throttling.** No minimum-interval setting is approved for role definitions, so none is invented:
  single-flight bounds the dependency to one in-flight request, but during a User Profile Service outage
  each lookup that finds a stale or absent snapshot still starts the next attempt after the previous one
  ends. A refresh back-off/minimum interval is a recommended production follow-up (a new configuration
  decision).
- **Diagnostics.** `getStatus()` returns only `{ state, definitionsVersion }` (`absent`, `fresh`, `stale`,
  `over-stale`) for later health reporting; the public `/health` is unchanged in this step.
- **Process-local.** Instances do not share snapshots; a restart empties the cache.
- **Logging.** Debug/warn events carry no role, capability, response body or user data; metrics are Step 13.
