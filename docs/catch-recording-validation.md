# Catch Recording Reusable Validation

> Produced by Phase 2, Step 07
> (`design/github-prompts/step-07-implement-reusable-validation.md`). This is a focused reference — see
> [`canonical-catch-record.md`](./canonical-catch-record.md) and
> [`catch-recording-normalisation.md`](./catch-recording-normalisation.md) for the contracts this module
> builds on.

## Purpose and ownership

**CatchValidation** (`src/catch-recording/validation/`) owns reusable Catch Recording domain validation
below the HTTP layer. It answers _"is this normalised canonical input structurally and semantically
valid for the requested operation?"_ — **Joi** (future HTTP routes) validates transport shape;
**CatchNormalization** (Step 06) produces the canonical input CatchValidation consumes; CatchValidation
never re-trims, re-coerces, or strips fields itself. CatchValidation is framework-neutral: no file
imports Hapi, Boom, Joi, or MongoDB (verified by `architecture-boundary.test.js` and a manual `grep`).

| File                             | Exports                                                                                               |
| -------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `validation-result.js`           | `formatPath`, `createValidResult`, `createInvalidResult`, `combineResults` — the one result contract  |
| `validation-codes.js`            | `VALIDATION_CODES` — the focused stable-code catalogue                                                |
| `structural.js`                  | `validateStructure(catchRecord)`                                                                      |
| `sections/gears.js`              | `validateGears(gears)` — duplicate detection, including a duplicate species `id` within the same gear |
| `sections/pair-fishing.js`       | `validatePairFishing(pairFishing)` — the one approved conditional rule                                |
| `sections/species-not-landed.js` | `validateSpeciesNotLanded(speciesNotLanded)` — root-level entry shape and duplicate-`id` detection    |
| `sections/trip.js`               | `validateTrip(trip)`                                                                                  |
| `catch-record.js`                | `validateCatchRecord(catchRecord)` — composes everything above                                        |

## The validation-result contract

```js
{ valid: boolean, issues: ReadonlyArray<{ code, path, message, meta? }> }
```

Frozen, deduplicated (by `code`+`path`+`message`), deterministically ordered. Never contains an HTTP
status, a rejected value, raw input, a cause, or internal metadata.

## Canonical field paths

Paths are arrays of segments (including numeric array indexes) joined with `.` via `formatPath` — e.g.
`gears.0.speciesCaught.0.id`. This mirrors the convention already established by Step 03's safe
detail-path representation (`src/common/helpers/errors/sanitise-details.js`); Step 07 reuses the same
format rather than inventing an association-ID-based scheme. A path describes a position in the specific
payload being validated at that moment — it is never stored or reused across requests.

## Stable validation codes

A focused, cross-domain catalogue (`VALIDATION_CODES`): `REQUIRED`, `INVALID_STRUCTURE`,
`UNSUPPORTED_VALUE`, `DUPLICATE_RELATIONSHIP`, `INVALID_REFERENCE`, `CONDITIONAL_FIELD_INCONSISTENT`. No
code exists for an unimplemented rule (e.g. no collection-limit code — see "Deferred decisions" below).

## What is validated

- **Structure** (`validateStructure`) — schema version, persisted-status enum, canonical hierarchy (no
  root-level `statisticalArea` or root-level _landed_-species collection — `speciesNotLanded` is the
  approved exception), shape-if-present for every section, and the one approved `REQUIRED` check: every
  gear occurrence must have a stable `associationId`. A species entry's own `id` is **not** required at
  this structural layer — exactly like `gear.id`, authoritative-reference requiredness is a
  section-validator business concern (`validateGears`/`validateSpeciesNotLanded`), not a structural one.
  **Completeness is never required** — a partial draft validates structurally fine.
- **Duplicates** (`validateGears`) — duplicate gear-association IDs; a duplicate species `id` _within
  the same gear's `speciesCaught`_. The same authoritative species under two different gears, or
  independently under `speciesNotLanded`, is explicitly valid and never flagged.
- **Pair-fishing conditional rule** (`validatePairFishing`) — when `enabled` is `false`,
  `pairVessel`/`pairSkipperName` must be `null` or absent. The reverse direction ("`enabled` requires
  fields") is not validated — the populated shape remains unresolved (Step 05).
- **Species not landed** (`validateSpeciesNotLanded`) — entry shape (required `id`, nullable-finite-number
  weight fields, approved `weightPrecision`) and a duplicate species `id` _within the root-level
  collection itself_. It is independent of every gear's `speciesCaught` — no cross-reference check is
  applied between them.
- **Complete-validation composition** (`validateCatchRecord`) — runs the above in a fixed order
  (structure → gears → pair-fishing → species-not-landed → trip) and combines the results. If the root
  itself is malformed, only the single structural failure is returned (no unsafe nested access is
  attempted).

## Determinism, ordering, and immutability

Composition always evaluates validators in the same fixed order; each validator traverses arrays in
their existing order. No validator mutates its input (including nested gear/species/trip structures) —
every test asserts the input is unchanged after validation.

## Translating a result into an HTTP error (not implemented yet)

No `ApplicationError` translation helper exists yet: no approved consumer (route) calls `CatchValidation`
today, so adding one now would be speculative. When a later phase's application boundary needs to reject
invalid data, it should translate an invalid result using the existing Step 03 contract: category
`BUSINESS_VALIDATION_FAILURE`, fallback code `BUSINESS_VALIDATION_FAILED`, and the result's `issues` as
safe validation details.

## Explicitly deferred (not implemented here)

- **Collection limits** — no limit is approved/configured (`docs/configuration-decisions.md`); no
  collection-limit code or rule exists.
- Gear-characteristic value/unit rules.
- Cross-validation between `weightPrecision` and the actual decimal places of a supplied weight value —
  deliberately not approved; `weightPrecision` is a display hint only.
- Reference-data validity / snapshot resolution (Phase 4, Steps 15–16).
- Lifecycle transition eligibility and display status (Step 08).
- Submission-readiness orchestration composing rules/dependencies not yet implemented (Step 32).

## Adding a new rule later

1. Confirm the rule is approved by an authoritative document.
2. Add it to the owning focused validator (or a new one, only if genuinely a new section).
3. Reuse `validation-result.js` and `formatPath` — do not invent a second result/path contract.
4. Add a focused, colocated test.
5. Keep the rule framework-neutral: no Hapi, Boom, Joi, MongoDB, or network access.

## Running the focused tests

```bash
npx vitest run src/catch-recording/validation
```
