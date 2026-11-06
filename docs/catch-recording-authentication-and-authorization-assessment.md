# Step 01: Current Authentication and Authorization Assessment

> Produced by Phase 01, Step 01
> (`design/github-prompts/step-01-assess-current-authentication-and-authorization.md`, executed via
> `design/github-prompts/phase-01-discovery-and-configuration-foundation-executor.md`). Assessment only —
> no production code, configuration, test, or dependency was changed to produce this document. Saved
> under `docs/` (not the step prompt's gitignored `design/` default path) because the entire `design/`
> directory is excluded from version control by this repository's `.gitignore` — `docs/` is the
> repository's actual established, committed location for every other produced design/assessment
> document (e.g. `docs/catch-recording-authentication.md`, `docs/catch-recording-authorisation.md`).

## 1. Executive summary

The Catch Recording Service currently authenticates every protected request by forwarding the caller's
`Authorization: Bearer <token>` header to an external **Authentication Service** (`POST
{authentication.baseUrl}/validate`), currently a mocked, separately-deployed service
(`mmo-cr-authentication-service`), not a hard-coded token list in this repository. The design documents'
`read-token`/`write-token`/`admin-token` vocabulary does **not** appear anywhere in `src/` — it exists only
in the Entra-migration design documents as illustrative placeholder names, not as current implementation
fact.

All 24 business (`/v1/...`) routes already require the trusted `authentication-service` Hapi auth strategy.
5 routes (`/health`, `/example`, `/example/{exampleId}`, `/openapi.json`, `/openapi.yaml`) are
deliberately public. Authorization is a separate, well-isolated, framework-neutral policy layer
(`src/catch-recording/security/`) offering exactly two authorization shapes today: **ownership**
(`userId === ownerUserId`, six operations), **vessel access** (vessel ID present in an externally-resolved
`accessibleVesselIds` list, sourced today from the Reference Data Service, not from any `vessel_roles`
claim), and one **permission/scope** check (`catch-recording.complete`) gating the restricted completion
operation. Domain/state-transition eligibility (`src/catch-recording/domain/lifecycle-transitions.js`) is
deliberately separate from both authentication and authorization and must continue to be preserved
unchanged.

Two pieces of existing documentation (`src/catch-recording/controller/authentication-plugin.js`'s module
docblock and `src/server.js`'s plugin-registration comment, plus `docs/catch-recording-authentication.md`'s
"What Step 13 does not do" section) are **stale**: they state the authentication strategy is "dormant"
with "no business route" enforcing it, which was true when Step 13 was implemented but is no longer true —
all 24 business routes enforce it today. This is flagged as a documentation-drift finding only; it is not
corrected here (out of Step 01's no-code-change scope) and is a low-risk candidate for a trivial follow-up
fix outside this phase.

No blocking security risk was found in the current implementation. The migration boundary for Steps 03–15
is clear: the `authentication-service` scheme/strategy, `authentication-client.js`'s HTTP contract, and
`vessel-access-policy.js`'s `accessibleVesselIds` input shape are the seams the Entra/`vessel_roles`/User
Profile Service work will need to replace or extend, while `ownership-policy.js`, `completion-policy.js`,
`resource-access-policy.js`, and all domain/lifecycle rules must be preserved unchanged (they operate on
`userId`/`scopes`, not on how those values were established).

## 2. Assessment scope

In scope: current authentication flow, mock/current-identity model, public/protected endpoint
classification, authorization controls (role/permission, vessel, ownership, resource, domain), security
tests/fixtures, related configuration/deployment assets, documentation impact, migration disposition, and
risks. Out of scope (per `step-01-assess-current-authentication-and-authorization.md` §12 "Out of scope"):
Entra application/tenant work, JWT/OIDC/JWKS implementation, `vessel_roles`/User Profile Service/role-cache/
capability-framework implementation, endpoint-security migration, and any production code change.

## 3. Sources inspected

- **Design/plan documents**: `design/github-prompts/phase-01-discovery-and-configuration-foundation-executor.md`,
  `design/github-prompts/step-01-assess-current-authentication-and-authorization.md`,
  `design/github-prompts/step-02-introduce-entra-and-authorization-configuration.md`,
  `design/github-prompts/step-03-implement-entra-jwt-validation-infrastructure.md`,
  `design/plans/catch-recording-service-entra-implementation-plan.md`,
  `design/plans/catch-recording-service-entra-phased-implementation-plan.md`.
- **Missing named document**: `final-entra-external-id-authentication-and-authorization-design.md` —
  searched repository-wide; does not exist anywhere in the repository. Recorded as missing; the two Entra
  implementation plans above and the Step 01–03 prompts provided sufficient approved context for this
  assessment.
- **Repository code**: `src/config.js`, `src/server.js`, `src/plugins/router.js`,
  `src/plugins/error-mapping.js`, `src/routes/*.js`, `src/catch-recording/controller/authentication-*.js`,
  `src/catch-recording/security/*.js`, `src/catch-recording/domain/lifecycle-transitions.js`,
  `lifecycle-status.js`, `src/common/helpers/errors/http-error-mapper.js`.
- **Existing documentation**: `docs/catch-recording-authentication.md`, `docs/catch-recording-authorisation.md`,
  `docs/configuration-decisions.md`, `docs/repository-context.md`, `docs/catch-recording-known-risks.md`,
  `docs/catch-recording-service-manual-testing.md`.
- **Deployment/CI**: `compose.yml`, `compose/aws.env`, `.github/workflows/check-pull-request.yml`.
- **Tests**: the 32 security-relevant test files listed in §13.
- **Package manifest**: `package.json` (npm scripts used for Step 01/02 verification).

## 4. Repository and technology baseline

- Node.js ES modules (`"type": "module"`), `#/` import alias to `src/` (`package.json` `imports`).
- Hapi.js 21 server composed in `src/server.js`; plugins registered in a fixed order (see §5).
- Joi 18 for request validation (`validate.options.abortEarly: false`, shared `failAction`).
- `@hapi/boom` + a single central `onPreResponse` error-mapping boundary
  (`src/plugins/error-mapping.js` → `src/common/helpers/errors/http-error-mapper.js`).
- `convict` 6.2.5 for configuration (`src/config.js`), validated with `config.validate({ allowed:
'strict' })` at module load; one custom format exists today (`mongo-uri`).
- Vitest with v8 coverage; `vitest-fetch-mock` (`fetchMock` global) for outbound-HTTP tests;
  `vi.stubEnv`/`vi.resetModules()` precedent exists (`src/common/helpers/start-server.test.js`).
- Working tree: clean. Branch `CRAR-33-Add-Entra-Exrernal-Athentication`. No pre-existing modified or
  untracked file (`git status --short` / `git diff --stat` both empty).

## 5. Current authentication flow

1. A caller sends `Authorization: Bearer <token>` on a request to a protected route.
2. Hapi's custom scheme `authentication-service` (`src/catch-recording/controller/authentication-scheme.js`)
   extracts the token via `extractBearerToken` — **only** an exact `"Bearer "`-prefixed string is ever
   treated as a credential; no other header, query, path, or payload value is ever used
   (`extractBearerToken`, lines 15–29).
3. The scheme calls `authenticationClient.validate({ token, correlationId })`
   (`authentication-client.js`), which:
   - Rejects immediately (no network call) if no token or no configured `baseUrl`
     (`guardValidateInput`).
   - Otherwise `POST`s `{authentication.baseUrl}/validate` with the forwarded bearer token and the
     `x-cdp-request-id` tracing header, under an `AbortController` timeout
     (`authentication.timeoutMs`), with bounded retries (`authentication.retryCount`/
     `retryDelayMs`) applied **only** to `502`/`503`/`504` responses.
   - Validates the success body is exactly `{ actorId: string, permissions: string[] }`
     (`parseSuccessBody`) — anything else is treated as a malformed response and fails closed.
4. `authentication-context.js`'s `createAuthenticationContext` maps `{ actorId, permissions }` to a
   frozen `{ userId, scopes }` context (permissions de-duplicated, order-preserving) — no raw token,
   claim, role, email, or profile data is ever exposed.
5. On success, the scheme calls `h.authenticated({ credentials })`, making
   `request.auth.credentials = { userId, scopes }` available to the handler. On any failure (missing
   token, unreachable/misconfigured Authentication Service, non-2xx, timeout, malformed body), the scheme
   returns `h.unauthenticated(authenticationRequiredError(cause))`, which the central error-mapping
   boundary turns into a safe `401` (`AUTHENTICATION_FAILURE`/`AUTHENTICATION_REQUIRED`).
6. Every outcome (success or failure) is audited via `@defra/cdp-auditing`
   (`{ event: 'catch_recording.authentication', outcome, code, correlationId }`) — the token, `actorId`,
   `scopes`, and raw Authentication Service response body are never logged or audited.

There is **no gateway-injected JWT claim set** consumed anywhere today, and **no literal mock-token string**
(`read-token`/`write-token`/`admin-token` or similar) exists in `src/`. See §8 for the full mock-dependency
inventory.

## 6. Current authorization model

Authorization is deliberately separate from authentication, implemented as pure, framework-neutral
policy functions under `src/catch-recording/security/` (confirmed framework-neutral by an automated test,
`architecture-boundary.test.js`, which asserts these files never import Hapi, Boom, Joi, MongoDB, the
Reference Data Service, persistence, or Redis). Every policy returns one of four outcomes
(`policy-outcome.js`): `ALLOWED`, `AUTHENTICATION_REQUIRED`, `ACCESS_DENIED`, `NOT_FOUND` — converted to
`401`/`403`/`404` only at the point of enforcement by `policy-errors.js`'s `enforcePolicyOutcome`.

Three authorization shapes exist today:

1. **Ownership** (`ownership-policy.js` → `decideOwnership`): exact `userId === ownerUserId` string match.
   Used (via `resource-access-policy.js`) for six operations: read, draft-update, draft-abandonment,
   submission, amendment, artifact-access. Denies with `NOT_FOUND` (not `ACCESS_DENIED`) on any
   missing/mismatched owner, to avoid confirming another owner's Catch Record exists (horizontal
   resource-enumeration protection).
2. **Vessel access** (`vessel-access-policy.js` → `decideVesselAccess`, reused as-is by
   `vessel-profile-policy.js`): authenticated + `vesselId` present in a trusted, already-resolved
   `accessibleVesselIds` array. **Today this array is populated exclusively by the Reference Data
   Service** (`referenceDataClient.listAccessibleVesselIds(...)`, called from
   `vessel-profile-access.js`, `create-draft-catch-record.js`, `replace-catch-record.js`, and
   `submission-readiness.js`), **not** by any Entra `vessel_roles` claim or User Profile Service call —
   that replacement is explicitly Steps 06/07's responsibility. Denies with `ACCESS_DENIED` (a vessel ID
   is reference data, not an owner secret).
3. **Restricted completion / permission** (`completion-policy.js` → `decideCompletionAccess`):
   authenticated + the trusted `scopes` collection contains the exact placeholder scope
   `catch-recording.complete` (case-sensitive exact match only, never substring/prefix/wildcard).
   Deliberately **not** owner-gated — per the approved decision recorded in
   `docs/configuration-decisions.md` ("Phase 4 decisions" → "Resource authorisation (Step 14)"), ordinary
   ownership never grants completion.

No generic role, group, or wildcard-permission concept exists; "scopes" (from the Authentication Service's
`permissions` array) is the only coarse-grained authorization input today, and it is used for exactly one
restricted operation (completion), not for route-level gating.

## 7. Authenticated principal and request-context model

`request.auth.credentials` is a frozen `{ userId: string, scopes: ReadonlyArray<string> }` object
(`authentication-context.js`). It is the **only** identity/authorization input every downstream
controller and security policy consumes (confirmed: every file in §6's "Trusted inputs only" section in
`docs/catch-recording-authorisation.md`). No session, cookie, or server-side identity store exists; the
context is rebuilt on every request from the Authentication Service's response. No raw JWT, OIDC claim,
email, or profile field is ever part of this context today — this is the exact seam Step 06
(`vessel_roles` claim integration) will need to extend without breaking the existing `{ userId, scopes }`
shape that `ownership-policy.js` and `completion-policy.js` already depend on.

## 8. Mock-token inventory

- **No literal `read-token`/`write-token`/`admin-token` string, static token map, or hard-coded
  always-allow bypass exists anywhere in `src/`** (confirmed by repository-wide search; these strings
  appear only in `design/` documents as illustrative placeholder names for the future Entra work).
- The **actual** "mock" element is external to this repository: `docs/catch-recording-authentication.md`
  states the Authentication Service "(currently a mock, always-allow implementation)" is a **separately
  deployed service** (`mmo-cr-authentication-service`, per `docs/configuration-decisions.md`'s "Phase 4
  decisions"), reached over real HTTP from this service's `authentication-client.js`. This repository only
  forwards the caller's bearer token to it and trusts its `{ actorId, permissions }` response — it does
  not itself decide what counts as a valid token.
- In tests, synthetic bearer tokens (e.g. `'valid-token'`-style strings) are used only as opaque values
  forwarded to a mocked HTTP layer (`fetchMock`, `vitest-fetch-mock`) that returns a canned
  `{ actorId, permissions }` response — this is test-fixture behaviour, not production mock-token logic.
  See `docs/catch-recording-service-manual-testing.md` line 25 for the one documented manual-testing
  placeholder (`TOKEN="replace-with-a-token-accepted-by-authentication-service"`).
- **Confidence: Confirmed.** **Migration disposition: `Out of scope`** for this repository (the mock
  Authentication Service itself lives in a sibling repository); the integration seam
  (`authentication-client.js`/`authentication-scheme.js`) is `Replace` (Step 05).

## 9. Public and protected endpoint matrix

| Method | Route                                                                             | Handler/controller                  | Public/Protected | Confidence |
| ------ | --------------------------------------------------------------------------------- | ----------------------------------- | ---------------- | ---------- |
| GET    | `/health`                                                                         | inline (`src/routes/health.js`)     | Public           | Confirmed  |
| GET    | `/example`                                                                        | `findAllExampleData`                | Public           | Confirmed  |
| GET    | `/example/{exampleId}`                                                            | `findExampleData`                   | Public           | Confirmed  |
| GET    | `/openapi.json`                                                                   | inline (`src/routes/openapi.js`)    | Public           | Confirmed  |
| GET    | `/openapi.yaml`                                                                   | inline (`src/routes/openapi.js`)    | Public           | Confirmed  |
| GET    | `/v1/catch-records`                                                               | `listCatchRecordsHandler`           | Protected        | Confirmed  |
| POST   | `/v1/catch-records`                                                               | `createDraftCatchRecordHandler`     | Protected        | Confirmed  |
| GET    | `/v1/catch-records/{catchRecordId}`                                               | `retrieveCatchRecordHandler`        | Protected        | Confirmed  |
| PUT    | `/v1/catch-records/{catchRecordId}`                                               | `replaceCatchRecordHandler`         | Protected        | Confirmed  |
| GET    | `/v1/catch-records/{catchRecordId}/history`                                       | `getCatchRecordHistoryHandler`      | Protected        | Confirmed  |
| DELETE | `/v1/catch-records/{catchRecordId}`                                               | `abandonDraftCatchRecordHandler`    | Protected        | Confirmed  |
| PATCH  | `/v1/catch-records/{catchRecordId}`                                               | `saveCatchRecordSectionHandler`     | Protected        | Confirmed  |
| POST   | `/v1/catch-records/{catchRecordId}/submission`                                    | `submitCatchRecordHandler`          | Protected        | Confirmed  |
| GET    | `/v1/catch-records/{catchRecordId}/submissions`                                   | `listSubmissionArtifactsHandler`    | Protected        | Confirmed  |
| GET    | `/v1/catch-records/{catchRecordId}/submissions/{submissionNumber}/{artifactType}` | `retrieveSubmissionArtifactHandler` | Protected        | Confirmed  |
| POST   | `/v1/catch-records/{catchRecordId}/completion`                                    | `completeCatchRecordHandler`        | Protected        | Confirmed  |
| POST   | `/v1/catch-records/{catchRecordId}/edit-start`                                    | `startCatchRecordEditHandler`       | Protected        | Confirmed  |
| GET    | `/v1/vessels/{vesselId}/favourite-gears`                                          | `listFavouriteGears`                | Protected        | Confirmed  |
| POST   | `/v1/vessels/{vesselId}/favourite-gears`                                          | `addFavouriteGear`                  | Protected        | Confirmed  |
| DELETE | `/v1/vessels/{vesselId}/favourite-gears/{gearId}`                                 | `removeFavouriteGear`               | Protected        | Confirmed  |
| GET    | `/v1/vessels/{vesselId}/favourite-species`                                        | `listFavouriteSpecies`              | Protected        | Confirmed  |
| POST   | `/v1/vessels/{vesselId}/favourite-species`                                        | `addFavouriteSpecies`               | Protected        | Confirmed  |
| DELETE | `/v1/vessels/{vesselId}/favourite-species/{speciesId}`                            | `removeFavouriteSpecies`            | Protected        | Confirmed  |
| GET    | `/v1/vessels/{vesselId}/favourite-ports`                                          | `listFavouritePorts`                | Protected        | Confirmed  |
| POST   | `/v1/vessels/{vesselId}/favourite-ports`                                          | `addFavouritePort`                  | Protected        | Confirmed  |
| DELETE | `/v1/vessels/{vesselId}/favourite-ports/{portId}`                                 | `removeFavouritePort`               | Protected        | Confirmed  |
| GET    | `/v1/vessels/{vesselId}/skippers`                                                 | `listSkippers`                      | Protected        | Confirmed  |
| POST   | `/v1/vessels/{vesselId}/skippers`                                                 | `addSkipperHandler`                 | Protected        | Confirmed  |
| DELETE | `/v1/vessels/{vesselId}/skippers/{skipperId}`                                     | `removeSkipperHandler`              | Protected        | Confirmed  |

**Totals: 29 registered routes — 5 public, 24 protected, 0 unresolved.** All 24 protected routes use the
literal Hapi `auth` option value `'authentication-service'` (constant `AUTH_STRATEGY` in both
`src/routes/catch-records.js` and `src/routes/vessel-profiles.js`); none uses a different or
partially-configured strategy.

## 10. Authentication component inventory

| File                                                       | Symbol                                              | Responsibility                                                                            | Registration/caller                                                                 | Confidence                                          | Disposition                                                                                                       |
| ---------------------------------------------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `src/catch-recording/controller/authentication-errors.js`  | `authenticationRequiredError`                       | Shared `ApplicationError` factory for every authentication failure mode                   | `authentication-client.js`, `authentication-context.js`, `authentication-scheme.js` | Confirmed                                           | Preserve                                                                                                          |
| `src/catch-recording/controller/authentication-client.js`  | `createAuthenticationClient`                        | Framework-neutral bounded HTTP adapter to the Authentication Service (`/validate`)        | `authentication-plugin.js`                                                          | Confirmed                                           | Replace (Step 03/05 JWT validation replaces this network call)                                                    |
| `src/catch-recording/controller/authentication-context.js` | `createAuthenticationContext`                       | Pure mapper `{ actorId, permissions }` → frozen `{ userId, scopes }`                      | `authentication-scheme.js`                                                          | Confirmed                                           | Review (shape likely preserved; source of `scopes` changes with `vessel_roles`)                                   |
| `src/catch-recording/controller/authentication-scheme.js`  | `authenticationServiceScheme`, `extractBearerToken` | Hapi custom auth scheme; sole trusted input is the `Authorization` header; audits outcome | `authentication-plugin.js` (`server.auth.scheme`)                                   | Confirmed                                           | Replace (Step 05 migrates this to Entra JWT validation)                                                           |
| `src/catch-recording/controller/authentication-plugin.js`  | `authenticationPlugin`                              | Registers the `authentication-service` scheme/strategy from plugin options                | `src/server.js`                                                                     | Confirmed                                           | Replace (Step 05)                                                                                                 |
| `src/server.js`                                            | plugin registration order/comment                   | Wires `authenticationPlugin` with `config.get('authentication')` before `router`          | —                                                                                   | Confirmed (code); comment is stale — see §1 and §15 | Review                                                                                                            |
| `src/config.js`                                            | `authentication.*`                                  | `baseUrl`/`timeoutMs`/`retryCount`/`retryDelayMs` for the Authentication Service client   | `src/server.js`                                                                     | Confirmed                                           | Preserve (unrelated to Entra config; stays as the legacy client's config until Step 15 removes the legacy client) |
| `src/routes/catch-records.js`, `vessel-profiles.js`        | `AUTH_STRATEGY = 'authentication-service'`          | Opts every business route into the strategy                                               | `src/plugins/router.js`                                                             | Confirmed                                           | Replace (Step 05/11 point routes at the new strategy/capability authorization)                                    |

## 11. Authorization-control inventory

| File                                                      | Symbol                                                                                                                                                   | Classification                                             | Registration/caller                                                                                         | Confidence | Disposition                                                                                                                                                                                                    |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/catch-recording/security/policy-outcome.js`          | `POLICY_DECISIONS`, `allowOutcome`, `denyOutcome`, `isAllowed`                                                                                           | Unclear/mixed (shared contract, not itself a control)      | Every policy module                                                                                         | Confirmed  | Preserve                                                                                                                                                                                                       |
| `src/catch-recording/security/policy-errors.js`           | `enforcePolicyOutcome`                                                                                                                                   | Unclear/mixed (outcome→HTTP mapping, not itself a control) | Every controller enforcing a policy                                                                         | Confirmed  | Preserve                                                                                                                                                                                                       |
| `src/catch-recording/security/ownership-policy.js`        | `decideOwnership`                                                                                                                                        | Ownership authorization                                    | `resource-access-policy.js`                                                                                 | Confirmed  | Preserve                                                                                                                                                                                                       |
| `src/catch-recording/security/resource-access-policy.js`  | `decideReadAccess`, `decideDraftUpdateAccess`, `decideDraftAbandonmentAccess`, `decideSubmissionAccess`, `decideAmendmentAccess`, `decideArtifactAccess` | Resource-level authorization                               | 6 Catch Record controllers (retrieve/save-section/abandon/submit/edit-start-amendment/submission-artifacts) | Confirmed  | Preserve                                                                                                                                                                                                       |
| `src/catch-recording/security/vessel-access-policy.js`    | `decideVesselAccess`                                                                                                                                     | Vessel-scoped authorization                                | `vessel-resolution.js`, `vessel-profile-policy.js`                                                          | Confirmed  | Review (its `accessibleVesselIds` _input source_ changes in Step 06/07; the policy function itself is preserved)                                                                                               |
| `src/catch-recording/security/vessel-profile-policy.js`   | `decideVesselProfileAccess`                                                                                                                              | Vessel-scoped authorization                                | `vessel-profile-access.js`, `vessel-favourites.js`, `vessel-skippers.js`                                    | Confirmed  | Review (same as above)                                                                                                                                                                                         |
| `src/catch-recording/security/completion-policy.js`       | `decideCompletionAccess`                                                                                                                                 | Permission-based authorization                             | `complete-catch-record.js`                                                                                  | Confirmed  | Preserve (consumes `scopes`; source of `scopes` may later be influenced by `vessel_roles`, but the gate itself stays `scopes.includes('catch-recording.complete')`)                                            |
| `src/catch-recording/reference-data/vessel-resolution.js` | (composes Reference Data Service lookup + `decideVesselAccess`)                                                                                          | Vessel-scoped authorization composition                    | `create-draft-catch-record.js`, `replace-catch-record.js`, `vessel-profile-access.js`                       | Confirmed  | Review (Reference Data Service vessel-permission source may be superseded by User Profile Service `vessel_roles`-derived roles per the phased plan's Step 06/07; this is an open migration question — see §21) |

## 12. Vessel, resource, ownership, and domain-rule inventory

- **Vessel**: §11 above (`vessel-access-policy.js`, `vessel-profile-policy.js`, `vessel-resolution.js`).
  Source of truth today: Reference Data Service (`referenceDataClient.listAccessibleVesselIds`), not
  `vessel_roles`.
- **Resource/ownership**: §11 above (`ownership-policy.js`, `resource-access-policy.js`). Source of truth:
  the Catch Record's own server-owned `ownerUserId` field, compared to `request.auth.credentials.userId`.
- **Domain/state-transition rules** (deliberately separate from authentication/authorization, per
  `docs/catch-recording-authorisation.md`'s "Purpose" section): `src/catch-recording/domain/
lifecycle-transitions.js` — `canSubmitFirstTime`, `canComplete`, `canStartEdit`, `canResubmit`,
  `canAbandon` each gate whether an _otherwise-authorized_ operation is valid for the resource's current
  `PERSISTED_STATUSES` value (`DRAFT`/`SUBMITTED`/`COMPLETE`) and submission count. These rules influence
  whether an operation **succeeds**, not whether the caller is **authorized** to attempt it — both checks
  run independently and must both pass. **Disposition: Preserve** — entirely out of scope for the Entra
  migration; Entra/`vessel_roles` work must not touch `lifecycle-transitions.js`/`lifecycle-status.js`.

## 13. Test and fixture inventory

32 test files exercise authentication/authorization directly or via a route/controller that depends on
`request.auth.credentials`:

- **Authentication unit/scheme tests (6)**: `authentication-client.test.js`, `authentication-context.test.js`,
  `authentication-errors.test.js`, `authentication-plugin.test.js`, `authentication-scheme.test.js` (5
  files, one per production module in §10), plus `http-error-mapper.test.js` (401/403 mapping).
- **Authorization policy unit tests (6)**: `ownership-policy.test.js`, `resource-access-policy.test.js`,
  `vessel-access-policy.test.js`, `vessel-profile-policy.test.js`, `completion-policy.test.js`,
  `policy-errors.test.js`, plus `architecture-boundary.test.js` and `boundary-integration.test.js`
  (framework-neutrality and end-to-end policy-composition tests — 8 files total in
  `src/catch-recording/security/`).
- **Route-level integration tests (2)**: `src/routes/catch-records.test.js`, `src/routes/vessel-profiles.test.js` —
  build a real Hapi server with the real `authenticationPlugin`/`referenceDataPlugin` registered and use
  `fetchMock` (`vitest-fetch-mock`) to stub the Authentication Service/Reference Data Service HTTP calls;
  assert `401` for a missing/invalid bearer token per route.
- **Controller tests depending on `authenticationContext`/vessel resolution (≈17)**: every Catch Record
  and vessel-profile controller test (`create-draft-catch-record.test.js`, `replace-catch-record.test.js`,
  `retrieve-catch-record.test.js`, `submit-catch-record.test.js`, `complete-catch-record.test.js`,
  `abandon-draft-catch-record.test.js`, `start-catch-record-edit.test.js`, `save-catch-record-section.test.js`,
  `catch-record-history.test.js`, `list-catch-records.test.js`, `list-submission-artifacts.test.js`,
  `retrieve-submission-artifact.test.js`, `vessel-favourites.test.js`, `vessel-skippers.test.js`,
  `vessel-profile-access.test.js`, `vessel-resolution.test.js`, `vessel-resolution-composition.test.js`,
  `submission-readiness.test.js`) constructs a synthetic `{ userId, scopes }` context directly, without
  going through the HTTP scheme — these are unaffected by an authentication-transport change as long as
  the `{ userId, scopes }` shape is preserved.
- **Fixture convention**: no shared "mock JWT" or "mock token" fixture module exists; each test builds its
  own literal `{ userId, scopes }` object or a `fetchMock` canned response inline.

**Migration impact**: Steps 03–05 (JWT/JWKS/middleware migration) will require updating/adding tests for
`authentication-client.test.js`/`authentication-scheme.test.js`/`authentication-plugin.test.js` and the two
route-level integration test files' authentication stubbing; the ~17 controller tests and the 8
authorization-policy tests should **not** need to change, since they depend only on the `{ userId, scopes }`
context shape, not on how it was produced.

## 14. Configuration and deployment inventory

- `src/config.js`: `authentication.baseUrl`/`timeoutMs`/`retryCount`/`retryDelayMs` (env
  `AUTHENTICATION_SERVICE_URL`/`AUTHENTICATION_SERVICE_TIMEOUT_MS`/`AUTHENTICATION_SERVICE_RETRY_COUNT`/
  `AUTHENTICATION_SERVICE_RETRY_DELAY_MS`), all `nullable`/have defaults, enforced only at runtime (no
  startup-time "is configured" gate exists for this legacy client either — confirmed: `cdpEnvironment`,
  `isProduction`, and `isTest` are declared in `src/config.js` but never read anywhere else in the
  repository).
- `compose.yml` / `compose/aws.env`: do not set `AUTHENTICATION_SERVICE_URL` (or any authentication
  variable) for local Docker Compose use — local development runs with authentication unconfigured by
  default (`baseUrl: null`), so every protected route returns `401` locally unless the variable is
  exported manually.
- `.github/workflows/check-pull-request.yml`: sets no authentication-specific environment variable; CI
  runs the full `npm test` suite, which stubs the Authentication Service via `fetchMock` per-test (§13) —
  it does not depend on a real or mock Authentication Service being reachable.
- `docs/catch-recording-service-manual-testing.md` line 25: documents a manual `TOKEN` placeholder
  environment variable for exercising protected routes locally against a real Authentication Service.

## 15. Documentation impact

- `docs/catch-recording-authentication.md` and `src/catch-recording/controller/authentication-plugin.js`'s
  docblock, and `src/server.js`'s plugin-list comment, are **stale**: all state the strategy is "dormant"
  / enforced by "no real route" — contradicted by §9's matrix (all 24 business routes enforce it). This is
  a documentation-drift finding, not corrected in this no-code-change step.
- `docs/catch-recording-authorisation.md` is accurate and current; it is the authoritative source for §6
  and §11–12 above.
- `docs/configuration-decisions.md`'s "Phase 4 decisions (Steps 13–16)" section is accurate and current;
  it is the authoritative source for the Authentication Service/Reference Data Service contract details
  cited in §5, §6, and §8.
- Step 02 onward will need to add new configuration documentation (not modify the above) for the Entra/
  authorization settings — see the Step 02 deliverable.

## 16. Component migration disposition matrix

| Component                                                                  | Disposition            | Reason                                                                                                                                                                 |
| -------------------------------------------------------------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `authentication-client.js`                                                 | Replace                | Step 03/05 JWT validation replaces the Authentication Service HTTP call                                                                                                |
| `authentication-scheme.js`                                                 | Replace                | Step 05 migrates the Hapi scheme to Entra JWT validation                                                                                                               |
| `authentication-plugin.js`                                                 | Replace                | Step 05 registers the new scheme/strategy instead                                                                                                                      |
| `authentication-errors.js`                                                 | Preserve               | The `ApplicationError`/`401` contract is framework-level, not transport-specific                                                                                       |
| `authentication-context.js`                                                | Review                 | `{ userId, scopes }` shape likely preserved; `scopes`' source changes                                                                                                  |
| `ownership-policy.js`                                                      | Preserve               | Operates only on `userId`, unaffected by identity-transport change                                                                                                     |
| `resource-access-policy.js`                                                | Preserve               | Same as above                                                                                                                                                          |
| `completion-policy.js`                                                     | Preserve               | Operates only on `scopes`, unaffected by identity-transport change                                                                                                     |
| `vessel-access-policy.js` / `vessel-profile-policy.js`                     | Review                 | Policy function preserved; `accessibleVesselIds` input source may migrate from Reference Data Service to User Profile Service per Steps 06/07 — open question, see §21 |
| `vessel-resolution.js`                                                     | Review                 | Composes Reference Data Service + `decideVesselAccess`; may need an alternate composition once `vessel_roles` exists                                                   |
| Domain/lifecycle rules (`lifecycle-transitions.js`, `lifecycle-status.js`) | Out of scope           | Entirely independent of authentication/authorization                                                                                                                   |
| `src/config.js` `authentication.*`                                         | Preserve until Step 15 | Legacy client config stays until mock authentication is removed                                                                                                        |
| Mock Authentication Service itself                                         | Out of scope           | Lives in a separate sibling repository (`mmo-cr-authentication-service`)                                                                                               |
| All 24 business routes' `auth: 'authentication-service'`                   | Replace later          | Step 05/11 repoint routes at the new strategy/capability authorization; unchanged in Phase 01                                                                          |

## 17. Security findings

- No hard-coded bypass, wildcard permission, or environment-based authentication bypass exists anywhere
  in `src/` (confirmed via targeted search and direct code reading of every file in §10–§11).
- The only coarse-grained permission check (`completion-policy.js`) uses an exact, case-sensitive scope
  match with no substring/prefix/wildcard fallback — a sound pattern to preserve in the capability-based
  replacement (Steps 09–12).
- Ownership denies with `NOT_FOUND` rather than `ACCESS_DENIED` specifically to prevent horizontal
  resource-ID enumeration — this must be preserved by any later resource-access-policy change.
- Local development (`compose.yml`) runs with authentication **unconfigured by default**
  (`AUTHENTICATION_SERVICE_URL` unset) — every protected-route call fails closed with `401` rather than
  silently bypassing authentication; this is a safe failure mode, not a risk.
- No secret, token, or credential is logged or audited anywhere in the authentication/authorization code
  paths inspected (confirmed by direct reading of `authentication-scheme.js`'s `auditOutcome` and
  `authentication-client.js`).
- Documentation drift (§15) is a low-severity finding: a developer reading the stale comments/doc could
  mistakenly believe authentication is not yet enforced on any real route.

## 18. Operational findings

- `authentication.timeoutMs`/`retryCount`/`retryDelayMs` bound every Authentication Service call
  (default `2000ms`/`1`/`100ms`); only `502`/`503`/`504` are retried — a sound, already-established
  resilience pattern that the Entra/User-Profile-Service HTTP clients (Steps 03–04, 07) should mirror.
- No cache exists today for authentication or authorization decisions — every request re-validates the
  token and re-resolves `accessibleVesselIds` from the Reference Data Service. The planned
  role-definition cache (Step 08) is new operational surface, not a replacement for existing caching
  (there is none to replace).

## 19. Test gaps

- No existing test asserts the _documentation_ in `authentication-plugin.js`/`server.js` matches the
  routes' actual `auth` option — the drift in §15 was only found by direct code inspection, not caught by
  any test. (Not a functional gap; a documentation-accuracy gap.)
- No dedicated `src/config.js` test exists today (confirmed: no `src/config.test.js` or equivalent in the
  repository) — Step 02 introduces the repository's first configuration-level test file.

## 20. Assumptions

- The Authentication Service's `/validate` contract (`{ actorId, permissions }` success body) is assumed
  stable and out of scope for Phase 01 — it is owned by a sibling repository.
- The Reference Data Service's `listAccessibleVesselIds` contract is assumed to remain the vessel-access
  source of truth until Steps 06/07 explicitly replace or supplement it with `vessel_roles`/User Profile
  Service data — no code change is proposed here.

## 21. Open questions

- Will `vessel_roles`-derived vessel access (Steps 06–08) **replace** the Reference Data Service's
  `listAccessibleVesselIds` call, or **supplement** it (e.g. union of both sources)? No approved document
  inspected in this phase resolves this; flagged for the step that implements Step 06/07, not for this
  phase to resolve.
- Will the restricted-completion scope name (`catch-recording.complete`) be renamed or reshaped once
  capability-based authorization (Steps 09–12) exists, or does it map directly to one capability? Flagged
  for Step 09/10, not for this phase.

## 22. Risks and controls

| Risk                                                                                                     | Control                                                                                                                                                                                                                                                     |
| -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A future step accidentally weakens the `NOT_FOUND`-on-mismatched-owner horizontal-enumeration protection | `resource-access-policy.test.js`/`ownership-policy.test.js` already assert this; must be preserved and kept passing through every later step                                                                                                                |
| A future step accidentally allows a non-RS256/non-approved JWT algorithm                                 | Addressed directly by Step 02's `allowedAlgorithms` allow-list (this phase) and Step 03's eventual validator                                                                                                                                                |
| Documentation drift (stale "dormant" claims) misleads a future contributor                               | Recommend a trivial, separately-scoped follow-up fix to `authentication-plugin.js`'s docblock, `server.js`'s comment, and `docs/catch-recording-authentication.md`'s "Context shape"/"What Step 13 does not do" sections — out of scope for Phase 01 itself |
| Local/CI environments silently run with authentication unconfigured                                      | Already fails closed (`401`) today; no change required                                                                                                                                                                                                      |

## 23. Recommended boundaries for Steps 02 through 15

- **Step 02** (this phase): introduce `entra.*`/`authorization.*` configuration only; do not touch any
  file listed as `Replace` in §16.
- **Steps 03–05**: must preserve `{ userId, scopes }` as `authentication-context.js`'s output shape so
  `ownership-policy.js`/`completion-policy.js`/`resource-access-policy.js` require no change.
- **Steps 06–08**: must resolve the Open Question in §21 (replace vs. supplement vessel-access source)
  before changing `vessel-access-policy.js`'s caller (`vessel-resolution.js`) or any controller that calls
  `referenceDataClient.listAccessibleVesselIds`.
- **Steps 09–12**: must preserve the exact-match, no-wildcard scope/capability semantics already
  established by `completion-policy.js`, and the `NOT_FOUND`/`ACCESS_DENIED`/`AUTHENTICATION_REQUIRED`
  outcome contract already established by `policy-outcome.js`/`policy-errors.js`.
- **Step 15**: only once routes are fully migrated should `authentication.*` config, the legacy
  `authentication-client.js`/`authentication-scheme.js`/`authentication-plugin.js` files, and their tests
  be removed.

## 24. Step 01 completion checklist

- [x] Every authentication entry point identified (§5, §10).
- [x] Every one of the 29 registered routes classified as public or protected (§9).
- [x] Every protected route has traceable authentication (`authentication-service` strategy, §9) and
      authorization (ownership/vessel/completion policies, §11) controls.
- [x] Every known usage of a "mock" authentication concept identified and clarified as an external mock
      service, not a literal in-repository token list (§8).
- [x] The authenticated-principal flow is documented (§7).
- [x] Existing role/permission (scope) checks documented (§6, §11).
- [x] Vessel, ownership, resource, and domain controls separately classified (§6, §11, §12).
- [x] Security-dependent tests and fixtures documented (§13).
- [x] Related configuration, deployment files, and documentation inventoried (§14, §15).
- [x] Each affected component has a migration disposition (§16).
- [x] Confirmed findings are separated from assumptions/open questions (§20, §21).
- [x] This assessment artifact is the only repository file created or modified by Step 01.
