# Configuration Decisions

> Produced by Phase 1, Step 04
> (`design/github-prompts/step-04-implement-required-configuration-contracts.md`). Records which
> configuration contracts are confirmed for this phase, and which are explicitly deferred — with the
> evidence and the step that will resolve each deferred item. No speculative value is introduced here;
> see [`docs/repository-context.md`](./repository-context.md) for the existing convict/configuration
> conventions this document follows.

## Confirmed: MongoDB connectivity

MongoDB connectivity is already fully configured and requires no change for Phase 1:

- `mongo.mongoUrl` (env `MONGO_URI`), validated by the repository's existing `mongo-uri` convict format
  (`src/common/helpers/convict/validate-mongo-uri.js`).
- `mongo.databaseName` (env `MONGO_DATABASE`).
- `mongo.mongoOptions.retryWrites` / `mongo.mongoOptions.readPreference` (env `MONGO_RETRY_WRITES` /
  `MONGO_READ_PREFERENCE`).

All defined in `src/config.js` and consumed by `src/plugins/mongodb.js`. No second MongoDB configuration
object is introduced, and no new MongoDB setting is required for the Catch Recording modules established
in Step 02, since none of them have executable persistence code yet.

## Confirmed: mandatory configuration fails safely

The existing convention — `config.validate({ allowed: 'strict' })` in `src/config.js` — already fails
fast and loud if a configuration value is missing, of the wrong shape, or an unrecognised key is present.
Phase 1 introduces no new configuration key, so there is nothing new that could fail unsafely; this
convention is simply confirmed as the one Catch Recording configuration must follow when a future step
adds a key.

## Deferred decisions

None of the following has an approved value anywhere in the approved plans, service design, or canonical
Catch Record object documents (confirmed by direct inspection, including a targeted search of
`design/architecture/canonical-catch-record-object.md` for limit/timeout/retention/URL-shaped terms, which
returned no matches). Introducing any of them now would mean inventing a business or operational decision,
which `design/github-prompts/step-04-implement-required-configuration-contracts.md` explicitly prohibits.
Each is resolved by its own later step, per
`design/plans/catch-recording-service-detailed-implementation-plan.md` §16 and
`design/architecture/catch-recording-service-design.md` §23 (both higher-precedence than this step's
broader framing).

| Deferred item                                                                                                                       | Resolved before                                                  | Notes                                                                                                                                                                                                                                                                                                                            |
| ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Catch Record / history / idempotency-record collection names                                                                        | Phase 3 (`CatchPersistence`, Steps 09–12)                        | Repository convention keeps collection names as source-level constants (e.g. `'mongo-locks'`, `'example-data'` in `src/plugins/mongodb.js`), not convict configuration. They are introduced by the module that owns them, not Step 04, and only `CatchPersistence` owns Mongo collection access.                                 |
| Idempotency record retention                                                                                                        | Step 12                                                          | No retention period is approved anywhere.                                                                                                                                                                                                                                                                                        |
| Business timezone                                                                                                                   | Step 17                                                          | Needed for friendly-reference generation; not needed by anything implemented in Phase 1.                                                                                                                                                                                                                                         |
| Reference Data Service base URL, timeout, retry, service authentication                                                             | Step 15                                                          | No endpoint, timeout, or retry value is approved.                                                                                                                                                                                                                                                                                |
| S3-compatible artifact storage (endpoint, region, bucket, credentials, path-style access)                                           | Step 33 (and the artifact-implementation decisions before it)    | Local `floci` infrastructure exists in `compose.yml` (region `eu-west-2`, dummy local credentials), but "do not assume local emulator credentials or endpoint behaviour applies to deployed environments" — no approved deployed bucket/region/credential strategy exists yet, and no `CatchArtifact` code exists to consume it. |
| PDF safety limits (max document size, max rendered text length, rendering timeout)                                                  | Step 33                                                          | No numeric value approved; no `PDFGenerator` code exists yet.                                                                                                                                                                                                                                                                    |
| HTTP payload limits                                                                                                                 | Deferred — see below                                             | See "Collection and payload limits" below.                                                                                                                                                                                                                                                                                       |
| Domain collection limits (gears per Catch Record, species per gear, catch details per species-gear, validation-detail output limit) | Phase 2 domain validation (from Step 07) / Phase 5 section saves | No numeric value approved anywhere, including the canonical Catch Record object document.                                                                                                                                                                                                                                        |
| Paging limits (default/max page size)                                                                                               | The read-API phase that implements listing                       | No numeric value approved.                                                                                                                                                                                                                                                                                                       |
| Trusted authentication settings (user-ID/role/scope claim names, issuer/audience, trusted headers)                                  | Step 13                                                          | Exact gateway claim contract is explicitly unresolved per the service design §14.1 and §23.                                                                                                                                                                                                                                      |

## Collection and payload limits — the one decision flagged as blocking Step 04 itself

Unlike every other row above, `design/plans/catch-recording-service-detailed-implementation-plan.md` §16
flags **"Final collection and payload limits"** as a decision required specifically **before Step 04**,
not before a later step. No numeric value for any HTTP payload limit or domain-collection limit appears
anywhere in the approved plans, service design, or canonical Catch Record object documents.

This was raised to the service owner during Step 04 (per the step prompt's Clarification Resolver / user-
escalation policy — inventing a number, or shipping a "mandatory, no default" contract that would break
today's local/test startup, were both rejected as unsafe). The owner's decision, recorded here:

> Defer entirely for Phase 1. No collection or payload-limit configuration is added. This remains an open
> decision for the phases that actually enforce it: domain validation (Phase 2, from Step 07) for the
> per-gear/per-species/per-catch-detail collection limits, and section-save/body-size enforcement
> (Phase 5 onward) for the payload byte limit; general listing/paging limits are resolved by whichever
> phase implements the read API.

No `server.payload.maxBytes` override, Joi array `.max()`, or paging default is introduced by Phase 1;
Hapi's own built-in default payload limit continues to apply implicitly until an approved number replaces
it.

## Security and privacy

No credential, token, access key, or secret key is introduced by this step (none was added — there is no
new configuration at all). Nothing in this document reproduces a secret value; the local `floci` S3-
emulator credentials referenced above are the well-known public dummy values used by that local tool, not
a real secret, and are not reproduced here regardless.
