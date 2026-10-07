# Catch Recording restricted completion

> Produced by Phase 8, Step 36
> (`design/github-prompts/step-36-implement-restricted-completion-command.md`). Owned by
> `src/catch-recording/controller/complete-catch-record.js`. The underlying decisions are recorded in
> [`docs/configuration-decisions.md`](./configuration-decisions.md) → "Phase 8 decisions" → "Step 36".

## Endpoint

```http
POST /v1/catch-records/{catchRecordId}/completion
```

No request payload — no completion evidence beyond the approved lifecycle precondition (`SUBMITTED`) is
approved anywhere, so none is invented. Requires the trusted `authentication-service` strategy, the exact
`catch-recording.complete` scope (already confirmed in `docs/catch-recording-authorisation.md`), an
`If-Match` header (the existing expected-version contract), and accepts an optional `Idempotency-Key`.

## Not owner-scoped

Completion is the one approved operation whose authorisation is purely permission-gated rather than
ownership-gated (`completion-policy.js`'s `decideCompletionAccess` has no `ownerUserId` parameter by
design — confirmed in Phase 4). Consequently:

- `findCatchRecordById` (new, trusted-internal, **not** owner-scoped) replaces the usual owner-scoped
  read — reserved exclusively for this step.
- `applyCompletion` (new persistence primitive) matches only `{ _id, status: SUBMITTED, version }` — no
  `ownerUserId` in its predicate, unlike every other atomic primitive in `CatchPersistence`.
- Targeted idempotency is scoped by the **completing administrator's own identity**, not the record's
  owner (there is no owner concept to scope by here).
- The appended `COMPLETED` history event still records the record's own `ownerUserId` (for an accurate
  audit trail) separately from the completing `actorUserId`.

## Orchestration order

1. `decideCompletionAccess` (authentication + exact scope) — enforced before any database access.
2. Optional idempotency claim and replay.
3. Trusted-internal read by id (no owner scoping).
4. Lifecycle eligibility (`canComplete` — only `SUBMITTED`).
5. Atomic `COMPLETE` commitment (`applyCompletion`).
6. Append-only history (`COMPLETED`).
7. Idempotency-claim completion, when a key was supplied.

## Response

Extends the existing standard save response with `completedAt` and `completedBy`. Submission count and
artifacts are untouched (not part of this `$set`) — completion never touches evidence already committed
by Step 34.

## What Step 36 does not do

- Accept an arbitrary target status — only the one explicit transition (`SUBMITTED` → `COMPLETE`) is
  possible; there is no generic status-update endpoint.
- Accept completion evidence, a reason, or any other payload field.
