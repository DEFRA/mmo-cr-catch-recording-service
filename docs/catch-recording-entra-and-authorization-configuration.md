# Catch Recording Entra and authorization configuration

> Produced by Phase 01, Step 02
> (`design/github-prompts/step-02-introduce-entra-and-authorization-configuration.md`, executed via
> `design/github-prompts/phase-01-discovery-and-configuration-foundation-executor.md`). Configuration
> only — no Entra authentication is active after this step. See
> [`docs/catch-recording-authentication-and-authorization-assessment.md`](./catch-recording-authentication-and-authorization-assessment.md)
> for the Step 01 baseline this configuration builds toward, and
> [`docs/configuration-decisions.md`](./configuration-decisions.md) → "Phase 01 decisions (Entra
> programme) — Step 02" for the three user-confirmed decisions behind the values below.

## Purpose

Introduce typed, validated `convict` configuration for the **future** Microsoft Entra External ID token
validation (Step 03) and capability-based authorization (Steps 06–12) work, following the repository's
existing configuration conventions exactly (`src/config.js`, the `src/common/helpers/convict/` custom-format
pattern). Nothing in this step reads, validates, or consumes these values at runtime yet.

## What this step does **not** do

- **JWT validation** is deferred to Step 03.
- **JWKS key rollover** is deferred to Step 04.
- **Authentication middleware migration** (replacing `authentication-service`) is deferred to Step 05.
- **`vessel_roles` claim parsing** is deferred to Step 06.
- **User Profile Service integration** (the HTTP client that will call `roleDefinitionsUrl`) is deferred
  to Step 07.
- **Role-definition caching** (the TTL/stale-duration behaviour) is deferred to Step 08.
- **Capability-based authorization** is deferred to Steps 09–12.
- Current authentication and authorization behaviour (see the Step 01 assessment) is completely
  unchanged.

## Activation

**No new "is Entra active" gate exists after this step** (user-confirmed decision — see
`docs/configuration-decisions.md`). Every `entra.*` setting stays `nullable`/`default: null`, mirroring
`authentication.baseUrl`/`referenceData.baseUrl` today — `config.validate({ allowed: 'strict' })` succeeds
in every environment regardless of whether these variables are set. Real required-field enforcement is
deferred to the step that actually consumes each value (Step 03 onward), matching this repository's
existing precedent that "required in production" for an external-service URL is enforced operationally
when the client using it is built, not at `config.js` load time.

## Settings

| Logical setting                              | Environment variable                         | Required                 | Type              | Default                 | Example                                                          | Validation                                                                                                                                                                                               | Consumed from |
| -------------------------------------------- | -------------------------------------------- | ------------------------ | ----------------- | ----------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| `entra.issuer`                               | `ENTRA_ISSUER`                               | No (nullable)            | string            | `null`                  | `https://entra.example.invalid/tenant/v2.0`                      | Non-empty when provided                                                                                                                                                                                  | Step 03       |
| `entra.audience`                             | `ENTRA_AUDIENCE`                             | No (nullable)            | string            | `null`                  | `api://catch-recording-example`                                  | Non-empty when provided                                                                                                                                                                                  | Step 03       |
| `entra.oidcMetadataUrl`                      | `ENTRA_OIDC_METADATA_URL`                    | No (nullable)            | string            | `null`                  | `https://entra.example.invalid/.well-known/openid-configuration` | Absolute `https://` URL when provided — no HTTP exception is approved                                                                                                                                    | Step 03       |
| `entra.allowedAlgorithms`                    | `ENTRA_ALLOWED_ALGORITHMS` (comma-separated) | Yes (has a safe default) | string[]          | `['RS256']`             | `RS256`                                                          | Non-empty array; every entry must be in the approved allow-list (`RS256` only); `none`/`HS256` always rejected                                                                                           | Step 03       |
| `authorization.rolesClaim`                   | `AUTHORIZATION_ROLES_CLAIM`                  | Yes (has a safe default) | string            | `'vessel_roles'`        | `vessel_roles`                                                   | Non-empty when overridden                                                                                                                                                                                | Step 06       |
| `authorization.serviceId`                    | `AUTHORIZATION_SERVICE_ID`                   | Yes (has a safe default) | string            | `'catch-recording'`     | `catch-recording`                                                | Non-empty when overridden                                                                                                                                                                                | Step 07       |
| `authorization.roleDefinitionsUrl`           | `USER_PROFILE_SERVICE_URL`                   | No (nullable)            | string            | `null`                  | `https://user-profile.example.invalid`                           | Absolute `http://`/`https://` **base** URL when provided (user-confirmed: a base URL, not a complete endpoint — Step 07's client appends `/roles-definitions/services/{serviceId}`)                      | Step 07       |
| `authorization.roleCacheTtlSeconds`          | `AUTHORIZATION_ROLE_CACHE_TTL_SECONDS`       | Yes (has a safe default) | integer (seconds) | `600` (user-confirmed)  | `600`                                                            | Positive integer, no fractional/overflow values                                                                                                                                                          | Step 08       |
| `authorization.roleCacheMaximumStaleSeconds` | `AUTHORIZATION_ROLE_CACHE_MAX_STALE_SECONDS` | Yes (has a safe default) | integer (seconds) | `6000` (user-confirmed) | `6000`                                                           | Positive integer, `>=` `roleCacheTtlSeconds` (checked explicitly in `src/config.js`, immediately after schema validation — convict cannot express a cross-field relationship in one property's `format`) | Step 08       |

No example above is a real tenant, application, or deployment value — every URL uses the reserved
`.invalid` domain (RFC 2606) and every identifier is a synthetic placeholder.

## Validation implementation

Four new named `convict` formats were added under `src/common/helpers/convict/`, following the exact
pattern already established by `validate-mongo-uri.js`:

| File                                   | Format name                | Used by                                                                                                                                           |
| -------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `validate-non-empty-string.js`         | `non-empty-string`         | `entra.issuer`, `entra.audience`, `authorization.rolesClaim`, `authorization.serviceId`                                                           |
| `validate-https-url.js`                | `https-url`                | `entra.oidcMetadataUrl`                                                                                                                           |
| `validate-base-url.js`                 | `base-url`                 | `authorization.roleDefinitionsUrl`                                                                                                                |
| `validate-algorithm-allowlist.js`      | `algorithm-allowlist`      | `entra.allowedAlgorithms` (also provides a `coerce` splitting a comma-separated env string into an array)                                         |
| `validate-positive-integer-seconds.js` | `positive-integer-seconds` | `authorization.roleCacheTtlSeconds`, `authorization.roleCacheMaximumStaleSeconds` (also provides a `coerce` converting an env string to a number) |

`authorization.roleDefinitionsUrl` deliberately does **not** use the built-in `url` format already
registered via `convict-format-with-validator` — that format accepts a bare, unscoped string (e.g.
`not-a-url`) when `require_tld: false` (confirmed empirically against the installed `validator` version),
which would not reject the "Invalid role-definition URL" case this step is required to cover.

## Startup validation

`src/config.js` already validates its entire schema once at module load
(`config.validate({ allowed: 'strict' })`) — this convention, not a new lifecycle hook, is reused for every
new setting. One additional explicit check immediately follows it for the one cross-field rule convict
cannot express in a single property's `format`:

```js
if (
  config.get('authorization.roleCacheMaximumStaleSeconds') <
  config.get('authorization.roleCacheTtlSeconds')
) {
  throw new Error(
    'authorization.roleCacheMaximumStaleSeconds must be greater than or equal to authorization.roleCacheTtlSeconds'
  )
}
```

Every error message names the failing configuration key (e.g. `entra.oidcMetadataUrl: must be an absolute
https:// URL`) and never includes a complete configuration dump, a credential, or a secret — none of these
settings is a secret in the first place (issuer/audience/metadata URL/roles claim/service ID/cache
durations/role-definitions base URL are all public, non-sensitive identifiers; the User Profile Service
gets no authentication configuration at this stage, matching the approved "current mock-service
constraint").

## Security considerations

- `RS256` is the only initially-approved JWT algorithm; `none` and `HS256` are always rejected, with no
  override mechanism.
- `entra.oidcMetadataUrl` requires `https://` unconditionally — no approved local/test HTTP exception
  exists, so none was introduced.
- No wildcard issuer/audience matching exists; both are independent non-empty strings.
- `authorization.roleDefinitionsUrl` (the User Profile Service base URL) carries no credential,
  authentication header, or request-signing configuration — consistent with the approved "current
  mock-service constraint" (Step 07 implements the HTTP client; Step 02 introduces no network behaviour
  at all).
- `authorization.roleCacheMaximumStaleSeconds` is bounded (a positive integer up to
  `Number.MAX_SAFE_INTEGER`) and must be `>=` the TTL, preventing an unbounded/indefinite stale-cache
  configuration once Step 08 implements the cache itself.

## Operational ownership

All nine settings are currently unset in every deployed environment (`compose.yml`/`compose/aws.env` set
none of them, matching `authentication.baseUrl`/`referenceData.baseUrl`'s existing precedent) and are not
yet consumed by any running code — there is no operational owner to assign until the consuming step
(column "Consumed from" above) is implemented. The CDP platform/environment owner for the deployed value
of each setting will be confirmed alongside that step.
