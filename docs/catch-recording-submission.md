# Catch Recording submission (idempotent first submission and resubmission)

> Produced by Phase 8, Step 34
> (`design/github-prompts/step-34-implement-idempotent-submission.md`). Owned by
> `src/catch-recording/controller/submit-catch-record.js`. The underlying decisions are recorded in
> [`docs/configuration-decisions.md`](./configuration-decisions.md) → "Phase 8 decisions" → "Step 34".

## Endpoint

```http
POST /v1/catch-records/{catchRecordId}/submission
```

No request payload. Requires the trusted `authentication-service` strategy, an `If-Match` header (the
existing expected-version contract, unchanged), and accepts an optional `Idempotency-Key` header
(applied only when supplied — the same optional-header precedent as Step 18's draft creation).

## One controller, two callers

`submitCatchRecord` is the single implementation reused identically by first submission (Step 34) and
resubmission of an amended draft (Step 38) — both source states are persisted `DRAFT` (never-submitted
or amended), so the same atomic persistence primitive (`applySubmission`) and the same artifact pipeline
serve both. The two cases differ only in:

- which lifecycle policy accepted it (`canSubmitFirstTime` vs `canResubmit`);
- the appended history event type (`SUBMITTED` vs `RESUBMITTED`).

## Orchestration order

1. Owner-scoped existing-record read (`findCatchRecordByIdForOwner`).
2. Optional idempotency claim and replay (checked **before** lifecycle eligibility — a retried request
   whose first attempt already succeeded will find the record no longer `DRAFT`, which would otherwise
   fail the lifecycle check before ever reaching the stored replay result).
3. Lifecycle eligibility (`canSubmitFirstTime` / `canResubmit`).
4. Complete validation (Step 32's `validateSubmissionReadiness`).
5. Deterministic submission-number calculation (`calculateNextSubmissionNumber`).
6. Deterministic-recovery-aware snapshot resolution (see below).
7. Sequential JSON-then-PDF artifact commitment (Step 33's `storeSubmissionArtifacts`).
8. Atomic `SUBMITTED` commitment (`applySubmission`) — status/version/lifecycle all guarded by the one
   atomic predicate, mirroring `applyCompleteReplacement`'s established pattern.
9. Append-only history (`SUBMITTED` or `RESUBMITTED`).
10. Idempotency-claim completion, when a key was supplied.

## The immutable snapshot

Built once per submission attempt: the complete canonical Catch Record, with `status`,
`numberOfSubmissions`, `hasUnsubmittedChanges`, `submittedAt`, and `submittedBy` overridden to their
post-commit values, excluding `artifacts` (self-referential) and `version` (a persistence-mechanical
counter, not business evidence). This exact object is serialised as the JSON snapshot artifact and passed
unchanged to `PDFGenerator`.

## Deterministic recovery

If artifact generation/storage fails before the database commit, no submission count increments and no
history is appended — the record stays exactly as it was. On retry (with or without an `Idempotency-Key`):

1. The deterministic JSON snapshot key for `(catchRecordId, submissionNumber)` is checked first.
2. If it already exists (a prior attempt got that far before crashing), its stored bytes are parsed and
   reused as the authoritative snapshot **unchanged** — never rebuilt with a new timestamp, so the
   subsequent artifact commit calls see byte-identical content and safely reuse the existing objects
   (Step 33's checksum-compare immutability mechanism) instead of raising an integrity conflict.
3. If it does not exist, a fresh snapshot is built with the current trusted timestamp.
4. The PDF is always (re)generated from whichever snapshot was resolved — deterministic because
   `PDFGenerator` fixes the embedded PDF `CreationDate` from the snapshot's own `submittedAt` rather than
   wall-clock time, making repeated generation from an identical snapshot byte-for-byte identical.

This is the primary safety mechanism (works with or without an idempotency key); the idempotency-key
replay is a secondary convenience for a request retried after its first attempt already fully succeeded.

## Response

Extends the existing standard save response (`buildStandardSaveResponse`) with `submittedAt`,
`submittedBy`, and `artifacts` (the complete, cumulative artifact-metadata array — prior submissions'
entries are never dropped). No new, incompatible response shape is introduced.

## What Step 34 does not do

- Expose artifact listing/retrieval (Step 35).
- Implement completion or edit-start (Steps 36/37).
- Introduce durable submission-operation state (no evidence yet shows deterministic recovery
  insufficient).
