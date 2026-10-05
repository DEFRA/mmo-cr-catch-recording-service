# Catch Recording Lifecycle and Display-Status Policies

> Produced by Phase 2, Step 08
> (`design/github-prompts/step-08-implement-lifecycle-and-display-status-policies.md`). This is a focused
> reference — see [`canonical-catch-record.md`](./canonical-catch-record.md) and
> [`catch-recording-validation.md`](./catch-recording-validation.md) for the contracts this module builds
> on.

## Purpose and ownership

Lifecycle policy (`src/catch-recording/domain/`) answers two framework-neutral questions over the Step 05
canonical contract: _"what can legitimately happen next to this record?"_ (eligibility) and _"is this
record's persisted state internally consistent?"_ (invariants) — plus one presentation concern, _"what
display status should a consumer show for this record?"_ (derivation). It never persists anything, never
calls HTTP/history/artifact/authorisation code, and never invents a rule the approved documents do not
state. No file imports Hapi, Boom, Joi, or MongoDB (verified by `architecture-boundary.test.js` and a
manual `grep`).

| File                       | Exports                                                                                                                                                |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `lifecycle-codes.js`       | `LIFECYCLE_CODES` — `INELIGIBLE_TRANSITION`, `INCONSISTENT_STATE`                                                                                      |
| `display-status.js`        | `DISPLAY_STATUSES`; `deriveDisplayStatus(catchRecord)`                                                                                                 |
| `submission-number.js`     | `calculateNextSubmissionNumber(currentCount)`                                                                                                          |
| `lifecycle-consistency.js` | `isNewDraft`, `isAmendedDraft`, `isConsistentAmendedState`, `isConsistentSubmittedState`, `isConsistentCompletedState`, `checkLifecycleInvariants`     |
| `lifecycle-transitions.js` | `canSubmitFirstTime`, `canComplete`/`buildCompletionFacts`, `canStartEdit`/`buildEditStartFacts`, `canResubmit`/`buildResubmissionFacts`, `canAbandon` |

## Result contract: reused, not reinvented

Every eligibility/consistency check returns the exact `{ valid, issues }` contract from
`src/catch-recording/validation/validation-result.js` (`createValidResult`, `createInvalidResult`,
`formatPath`) — imported, never duplicated. A small, separate `LIFECYCLE_CODES` catalogue exists because
Step 07's codes describe data-shape/business-validation concerns, none of which fit "this transition is
not currently eligible" or "this state is internally inconsistent" — the two concerns this module adds.

## Persisted statuses vs. display status

Only three statuses are ever persisted (`src/catch-recording/domain/lifecycle-status.js`): `DRAFT`,
`SUBMITTED`, `COMPLETE`. **Amended is never persisted** — it is always derived, on demand, from
`status === 'DRAFT'` combined with `numberOfSubmissions > 0`:

| Persisted `status` | `numberOfSubmissions` | Derived display status |
| ------------------ | --------------------- | ---------------------- |
| `DRAFT`            | `0`                   | `Draft`                |
| `DRAFT`            | `> 0`                 | `Amended`              |
| `SUBMITTED`        | any                   | `Submitted`            |
| `COMPLETE`         | any                   | `Complete`             |

`deriveDisplayStatus` returns `undefined` for an unsupported status or an invalid `numberOfSubmissions`
(non-integer or negative) rather than inventing a fallback such as `"Unknown"`. It reads only **own**
properties (`Object.hasOwn`) so an inherited, prototype-chain `status`/`numberOfSubmissions` is never
trusted.

## Lifecycles

### New draft

A never-submitted record: `status=DRAFT`, `numberOfSubmissions=0`, `hasUnsubmittedChanges=false`,
`artifacts=[]`, `submittedAt`/`submittedBy`/`completedAt`/`completedBy` all `null` — directly transcribed
from the Step 05 `NEW_DRAFT_DEFAULTS`. Checked by `isNewDraft`.

### First submission

`canSubmitFirstTime` is eligible only when `status=DRAFT` and `numberOfSubmissions=0`. The first
submission number is `calculateNextSubmissionNumber(0) = 1`.

### Submitted-state consistency

`isConsistentSubmittedState` requires `status=SUBMITTED`, `numberOfSubmissions>=1`,
`hasUnsubmittedChanges=false`, non-null `submittedAt`/`submittedBy`, `artifacts.length>=1`, and
`completedAt`/`completedBy` both `null` — a record cannot simultaneously be `SUBMITTED` and carry
completion metadata.

### Completion

`canComplete` is eligible only from `status=SUBMITTED` (never `DRAFT` or `COMPLETE`). `buildCompletionFacts`
returns only `{ status: 'COMPLETE' }` — no timestamp, actor, or version; those remain Step 36's
responsibility. `isConsistentCompletedState` requires `status=COMPLETE`, `numberOfSubmissions>=1`,
non-null `submittedAt`/`submittedBy`, non-null `completedAt`/`completedBy`, `artifacts.length>=1`, and
`hasUnsubmittedChanges=false`.

### Edit-start (amendment)

`canStartEdit` is eligible from `status=SUBMITTED` or `status=COMPLETE` (never from `DRAFT`).
`buildEditStartFacts` returns:

```js
{
  id, catchRecordReference, numberOfSubmissions, artifacts,
  status: 'DRAFT',
  hasUnsubmittedChanges: true,
  completedAt, completedBy
}
```

**Owner decision (recorded in the Step 08 plan):** `completedAt`/`completedBy` are **preserved
unchanged**, not cleared, during edit-start — the approved documents confirm `submittedAt`/`submittedBy`
persist through amendment but say nothing about completion metadata; preserving is consistent with the
"edit in place, preserve history, never clone" principle used throughout the design. This was escalated
to and confirmed by the user before implementation.

### Amended draft

`isAmendedDraft` (boolean predicate) is true for `status=DRAFT` with `numberOfSubmissions>0`.
`isConsistentAmendedState` additionally requires `hasUnsubmittedChanges=true` (the only route back to
`DRAFT` with prior submissions is edit-start, which always sets this true) and `artifacts.length>=1`
(prior submission evidence preserved).

### Resubmission

`canResubmit` is eligible only when `isAmendedDraft` is true (`DRAFT` with `numberOfSubmissions>0`); a
never-submitted draft, `SUBMITTED`, or `COMPLETE` are all ineligible. `buildResubmissionFacts` returns
`{ status: 'SUBMITTED', numberOfSubmissions: <next>, hasUnsubmittedChanges: false }`. It deliberately
excludes `artifacts` — writing new artifact metadata is a later step's responsibility, and this policy
neither writes artifacts nor discards the existing ones.

### Abandonment

`canAbandon` is eligible only when `status=DRAFT`, `numberOfSubmissions=0`,
`submittedAt`/`submittedBy` both absent/null, and `artifacts.length=0` (no committed submission
evidence). An amended draft, a submitted record, and a completed record are all ineligible.

## Submission numbering

`calculateNextSubmissionNumber(currentCount)` accepts only a non-negative safe integer and returns
`count + 1`. It returns `undefined` — never a silent `0` or `1` fallback — for negative, fractional,
non-numeric, missing, or unsafe (`> Number.MAX_SAFE_INTEGER`) input.

## `checkLifecycleInvariants`

Dispatches a canonical record to the correct consistency check by its persisted `status` and amendment
state (`isAmendedDraft`): `DRAFT` routes to `isNewDraft` or `isConsistentAmendedState`; `SUBMITTED` routes
to `isConsistentSubmittedState`; `COMPLETE` routes to `isConsistentCompletedState`. An unsupported status
or malformed root produces an invalid result rather than silently passing.

## Purity, determinism, and immutability guarantees

Every function only reads its input (via `Object.hasOwn`-guarded own-property access — an inherited
property is never trusted) and returns a freshly constructed plain object/array; nothing is mutated.
`buildCompletionFacts`/`buildEditStartFacts`/`buildResubmissionFacts` each return the **minimal** set of
fields the policy actually owns — never a full merged record — and are asserted by test to return a new
reference distinct from the input. No function reads the current time, randomness, an environment
variable, the network, or a database.

## Boundaries with other steps and concerns (explicitly out of scope here)

- **Step 07 validation** — lifecycle policy never re-validates data shape; it assumes a canonical,
  already-normalised record and only reasons about `status`/`numberOfSubmissions`/metadata fields.
- **CatchSubmission orchestration, persistence, authorisation, idempotency** — this module proposes
  eligibility and minimal proposed facts only; applying them, checking a caller's permission, enforcing
  idempotency, and writing to MongoDB all remain with their owning later steps (e.g. Step 36).
- **Timestamps, actor resolution, optimistic-concurrency version increment, friendly-reference
  generation, history, artifact writes** — none are computed or written here.
- **Draft deletion vs. inactive retention** (Step 19) and the **exact HTTP version-conflict
  representation** remain unresolved by design and are not addressed by this module.

## Adding a new rule later

1. Confirm the rule is approved by an authoritative document (or escalate a genuine ambiguity to the
   user, as was done for `completedAt`/`completedBy` above).
2. Add it to the owning file (`lifecycle-consistency.js` for an invariant, `lifecycle-transitions.js` for
   an eligibility/fact-building rule) — do not create a third/competing module.
3. Reuse `validation-result.js` (`createValidResult`/`createInvalidResult`/`formatPath`) and
   `LIFECYCLE_CODES` — do not invent a second result or code contract.
4. Add a focused, colocated test, including a malformed-root case and an immutability assertion.
5. Keep the rule framework-neutral: no Hapi, Boom, Joi, MongoDB, or network/time/randomness access.

## Running the focused tests

```bash
npx vitest run src/catch-recording/domain
```
