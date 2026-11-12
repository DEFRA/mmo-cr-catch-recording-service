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
