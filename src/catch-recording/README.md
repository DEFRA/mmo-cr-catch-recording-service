# Catch Recording module ownership root

This directory is the agreed ownership root for the eight Catch Recording modules. See
[`docs/catch-recording-modules.md`](../../docs/catch-recording-modules.md) for each module's
responsibilities, exclusions, and the approved dependency direction.

## Modules implemented so far

- `domain/` — the Step 05 canonical Catch Record contract and the Step 08 lifecycle/display-status
  policies. See [`docs/canonical-catch-record.md`](../../docs/canonical-catch-record.md) and
  [`docs/catch-recording-lifecycle.md`](../../docs/catch-recording-lifecycle.md).
- `normalization/` — the Step 06 input normalisation module.
- `validation/` — the Step 07 reusable domain validation module.
- `persistence/` — the Step 09 `CatchPersistence` module: the sole Catch Recording owner of Catch Record
  MongoDB access (collection ownership, canonical ⇄ document mapping, create, owner-scoped retrieval,
  one existing-record atomic compare-and-update primitive, a bounded owner-scoped list primitive, and
  required indexes), the Step 10 simple append-only Catch Record history capability (a separate
  `catch-record-history` collection, a framework-neutral history-event contract, append-only insertion,
  and an owner-safe, bounded, deterministically-ordered query by Catch Record), the Step 11
  framework-neutral expected-version contract plus atomic optimistic-concurrency compare-and-update
  (matching Catch Record identity, trusted owner, and expected version in one atomic predicate, with an
  exact single version increment and a deterministic `VERSION_CONFLICT` outcome distinct from safe
  not-found), and the Step 12 targeted-idempotency capability (a separate `catch-idempotency-claims`
  collection; framework-neutral key, closed operation-scope, and deterministic request-fingerprint
  contracts; an atomic first-claim operation backed solely by a MongoDB unique index; and a scoped
  completion operation storing only a minimal allow-listed replay result) — targeted at exactly the seven
  operations approved by the detailed plan §5.2 (draft creation, submission, edit start, resubmission, add
  favourite, add skipper, completion), explicitly **excluding** ordinary section PATCH operations, which
  continue to rely solely on Step 11's optimistic concurrency. See
  [`docs/catch-recording-persistence.md`](../../docs/catch-recording-persistence.md). Does not implement
  any business endpoint/operation, idempotency retention/TTL, routes, the HTTP transport representation for
  the expected version, or authentication/authorisation — those are later steps or deferred decisions.
- `controller/` — the Step 13 trusted authentication context: a bounded Authentication Service client, a
  framework-neutral `{ userId, scopes }` context mapper, and a dormant Hapi `authentication-service` auth
  scheme/plugin (no route is enforced yet). See
  [`docs/catch-recording-authentication.md`](../../docs/catch-recording-authentication.md).
- `security/` — the Step 14 resource-authorisation policies: ten explicit, default-deny, framework-neutral
  policies (vessel access, Catch Record ownership, read, draft-update, draft-abandonment, submission,
  amendment, artifact access, vessel-profile access, restricted completion), one shared policy-outcome
  contract, and one error-enforcement helper reusing the existing Step 03 error categories. See
  [`docs/catch-recording-authorisation.md`](../../docs/catch-recording-authorisation.md).

Rules for adding code here:

- Create a module subdirectory (`controller/`, `normalization/`, `submission/`, `query/`,
  `validation/`, `persistence/`, `artifact/`, `pdf/`) only when the implementation step that owns it adds
  its first real file. Do not pre-create an empty subdirectory.
- Keep a small module to one implementation file and one colocated test; split further only when the
  module has enough code to justify it.
- Application and domain modules must not import Hapi, `@hapi/boom`, the `mongodb` driver, or an
  object-storage SDK — those belong to the owning adapter (`controller/`, `persistence/`, `artifact/`).
- Do not add a pass-through wrapper, placeholder file, or empty barrel export.

This repository is a greenfield Catch Recording implementation: no module here may reference a previous
Catch Recording implementation, legacy fields, migration or compatibility behaviour, Redis, or any
application cache.
