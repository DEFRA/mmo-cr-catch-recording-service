# Catch Recording amendment saves and resubmission

> Produced by Phase 8, Step 38
> (`design/github-prompts/step-38-implement-amendment-saves-and-resubmission.md`). The underlying
> decisions are recorded in [`docs/configuration-decisions.md`](./configuration-decisions.md) → "Phase 8
> decisions" → "Step 38".

## No new endpoints

Per the approved design, amendment saves and resubmission both reuse existing endpoints exactly:

- **Amendment saves** — the existing generic section `PATCH /v1/catch-records/{catchRecordId}`
  (Step 20/21), unchanged in shape.
- **Resubmission** — the existing `POST /v1/catch-records/{catchRecordId}/submission` (Step 34),
  unchanged in shape — `submitCatchRecord` already branches on `canResubmit` vs `canSubmitFirstTime` and
  was fully implemented and tested in Step 34.

## What Step 38 actually added

Two gaps, both in the existing section-PATCH pipeline, were closed:

1. **Lifecycle protection for section PATCH.** `applySectionUpdate`'s atomic predicate now embeds
   `status: DRAFT` (mirroring `applyCompleteReplacement`'s established pattern) — previously, nothing
   prevented a section PATCH from being applied directly to a `SUBMITTED`/`COMPLETE` record, bypassing
   edit-start entirely. A `SUBMITTED`/`COMPLETE` record must now return to `DRAFT` via Step 37's
   edit-start before any section may be saved (`CATCH_RECORD_SECTION_UPDATE_INELIGIBLE` otherwise).
2. **Amendment-save history distinction.** `saveCatchRecordSection` now appends
   `AMENDMENT_SECTION_SAVED` (not `SECTION_SAVED`) when the _updated_ record is an amended draft
   (`status === DRAFT && numberOfSubmissions > 0`) — determined from the already-returned updated
   document, not a separate pre-read (`applySectionUpdate` never touches `numberOfSubmissions`, so its
   before/after value is identical).

## Preservation guarantees (already correct by construction)

- **`hasUnsubmittedChanges` stays `true` throughout amendment editing** — no section-save code path ever
  touches this field; it is set only by edit-start (`true`) and cleared only by a successful
  (re)submission (`false`).
- **Prior artifacts and history are preserved** — `applySectionUpdate`'s `$set` never includes
  `artifacts`; every earlier committed submission's evidence survives unchanged through any number of
  amendment saves.
- **Resubmission increments the submission count exactly once** and clears `hasUnsubmittedChanges` —
  both already guaranteed by Step 34's `applySubmission`/`calculateNextSubmissionNumber`.

## What Step 38 does not do

- Add a separate amendment-save or resubmission endpoint.
- Add a new history-event taxonomy beyond the one additional type (`AMENDMENT_SECTION_SAVED`) already
  reserved for this purpose since Step 10's original catalogue.
