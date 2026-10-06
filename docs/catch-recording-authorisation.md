# Catch Recording resource authorisation

> Produced by Phase 4, Step 14
> (`design/github-prompts/step-14-implement-resource-authorisation-policies.md`). Owned by
> `src/catch-recording/security/`. The underlying decisions are recorded in
> [`docs/configuration-decisions.md`](./configuration-decisions.md) → "Phase 4 decisions (Steps 13-16)".

## Purpose

Resource authorisation answers one question only: **may this already-authenticated caller perform this
operation on this resource?** It is explicit and default-deny, and it is deliberately separate from:

- **Authentication** ("who is the caller?") — produced by [Step 13](./catch-recording-authentication.md).
- **Lifecycle policy** ("is this operation valid for the resource's current state?") — Step 08.
- **Validation** ("is the supplied data valid?") — Step 07.
- **Persistence** ("how is the resource stored and retrieved?") — Step 09.

Knowing a Catch Record ID or a vessel ID is never, by itself, proof of access.

## Trusted inputs only

Every policy in this module consumes only:

- The Step 13 `{ userId, scopes }` authentication context.
- Explicitly-supplied trusted resource attributes (e.g. a Catch Record's `ownerUserId`, which is always
  server-owned) or a trusted, already-resolved fact (e.g. `accessibleVesselIds`, resolved by a later
  step's Reference Data Service composition — never fetched by this module itself).

No policy here calls MongoDB, the Reference Data Service, Hapi, Boom, or Joi directly
(`architecture-boundary.test.js` enforces this).

## The policy-outcome contract

`policy-outcome.js` defines one small, deterministic outcome: `{ decision }`, where `decision` is one of
`ALLOWED`, `AUTHENTICATION_REQUIRED`, `ACCESS_DENIED`, or `NOT_FOUND`. `policy-errors.js`'s
`enforcePolicyOutcome` converts a non-`ALLOWED` outcome into the existing Step 03 `ApplicationError` — no
new error category or per-operation error code is introduced:

| Decision                  | Category                 | HTTP |
| ------------------------- | ------------------------ | ---- |
| `AUTHENTICATION_REQUIRED` | `AUTHENTICATION_FAILURE` | 401  |
| `ACCESS_DENIED`           | `AUTHORISATION_FAILURE`  | 403  |
| `NOT_FOUND`               | `RESOURCE_NOT_FOUND`     | 404  |

## Not-found versus access-denied

- **Ownership-scoped policies** (read, draft-update, draft-abandonment, submission, amendment,
  artifact-access) deny a missing/mismatched owner with safe `NOT_FOUND` — consistent with Step 09's
  owner-scoped persistence, which already returns no accessible resource rather than confirming another
  owner's record exists. This prevents horizontal resource enumeration.
- **Vessel-access, vessel-profile, and completion policies** deny with `ACCESS_DENIED` — a vessel
  identifier or a missing administrative permission is not owner-secret information.

## The ten policies

| Policy                                                                      | File                        | Gate                                                                         |
| --------------------------------------------------------------------------- | --------------------------- | ---------------------------------------------------------------------------- |
| Vessel access                                                               | `vessel-access-policy.js`   | Authenticated + vessel ID present in the trusted `accessibleVesselIds`       |
| Catch Record ownership                                                      | `ownership-policy.js`       | Authenticated + exact `userId === ownerUserId` match                         |
| Read / draft-update / draft-abandonment / submission / amendment / artifact | `resource-access-policy.js` | The ownership check above, one distinctly-named function per operation       |
| Vessel-profile access                                                       | `vessel-profile-policy.js`  | Same gate as vessel access                                                   |
| Restricted completion                                                       | `completion-policy.js`      | Authenticated + exact `catch-recording.complete` scope — **not** owner-gated |

Six operations (read, draft-update, draft-abandonment, submission, amendment, artifact-access) share
identical authorisation gating today — one internal implementation, six distinctly-named, individually
tested entry points, so each can diverge independently later without affecting the others.

Completion deliberately has **no** `ownerUserId` parameter: per the approved decision, ordinary ownership
never grants completion — it is purely permission-gated, matching its description as a _restricted
administrative_ capability.

## Security and privacy

- Only own-enumerable allow-listed properties are read; an inherited/prototype-chain property is never
  trusted.
- No outcome ever contains a resource, an owner ID, a vessel permission, a scope, or a token.
- No policy input is mutated; no policy output shares a mutable reference with its input.
- No unknown role, scope, or operation ever receives a default allow.

## Explicit exclusions

- No Reference Data Service call, MongoDB query, or persistence mutation.
- No business operation (draft creation, submission, completion, amendment orchestration).
- No generic policy engine, administrator role, wildcard permission, or environment-based bypass.
- No Redis or application-cache technology.
- Step 15's Reference Data Service client, Step 16's vessel-access composition with real Reference Data
  Service resolution, and later route-specific policy composition are explicitly deferred.
