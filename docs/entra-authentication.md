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
