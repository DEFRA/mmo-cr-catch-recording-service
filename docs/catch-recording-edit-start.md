# Catch Recording edit-start (in-place amendment)

> Produced by Phase 8, Step 37
> (`design/github-prompts/step-37-implement-edit-start-and-in-place-amendment.md`). Owned by
> `src/catch-recording/controller/start-catch-record-edit.js`. The underlying decisions are recorded in
> [`docs/configuration-decisions.md`](./configuration-decisions.md) → "Phase 8 decisions" → "Step 37".

## Endpoint

```http
POST /v1/catch-records/{catchRecordId}/edit-start
```

No request payload — no amendment-reason field exists anywhere in the canonical contract or domain
policies (`buildEditStartFacts` takes no `reason` parameter), so none is invented. Owner-scoped, exactly
like submission (amendment authorisation is ownership-gated — confirmed in
`docs/catch-recording-authorisation.md`, unlike completion's permission-gated model). Requires the
trusted `authentication-service` strategy, an `If-Match` header, and accepts an optional
`Idempotency-Key`.

## Eligible source states

Both `SUBMITTED` and `COMPLETE` may return to `DRAFT` via edit-start (confirmed by the pre-existing
`canStartEdit` domain policy) — an already-`DRAFT` record (never-submitted or amended) is not eligible.

## In-place, never cloned

`applyEditStart` (the new atomic persistence primitive) `$set`s only three fields — `status: DRAFT`,
`hasUnsubmittedChanges: true`, and audit metadata — and leaves everything else untouched:

- `id` and `catchRecordReference` are never regenerated.
- `numberOfSubmissions` and `artifacts[]` survive unchanged (preserving every prior submission's
  evidence).
- `completedAt`/`completedBy` are preserved, never cleared — editing after completion does not erase the
  record of that completion.
- `DRAFT_EDIT`/`AMENDED` are never persisted statuses; `Amended` remains a derived display state
  (`status === DRAFT && numberOfSubmissions > 0`).

## Response

Reuses the existing standard save response unchanged (`buildStandardSaveResponse`) — `hasUnsubmittedChanges`
and the preserved `numberOfSubmissions` are already present in its `progress` field, so no response-shape
extension was needed (unlike submission/completion, which added genuinely new facts).

## What Step 37 does not do

- Clone the Catch Record.
- Accept or persist an amendment reason.
- Implement amendment saves or resubmission (Step 38 reuses the existing generic PATCH and submission
  endpoints for those).
