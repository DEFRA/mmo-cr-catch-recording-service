# Catch Recording Input Normalisation

> Produced by Phase 2, Step 06
> (`design/github-prompts/step-06-implement-input-normalisation.md`). This is a focused reference — see
> [`canonical-catch-record.md`](./canonical-catch-record.md) for the authoritative canonical contract
> this module targets.

## Purpose and ownership

**CatchNormalization** (`src/catch-recording/normalization/`) converts approved client-owned input into
deterministic canonical input form. It answers _"how is supported client-owned input represented
consistently?"_ — not _"is it valid?"_ (that is Step 07's reusable validation) and not _"what HTTP shape
is accepted?"_ (that is Joi, at the route boundary). CatchNormalization is framework-neutral: no file
imports Hapi, Boom, Joi, or MongoDB (verified by `architecture-boundary.test.js` and a manual `grep`).

| File                             | Exports                                                                                                                             |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `primitives.js`                  | `normaliseTrimmedString(value)` — the one approved primitive transformation                                                         |
| `object-helpers.js`              | `copyField`, `normaliseReferenceSelection`, `normaliseArray` — the shared explicit-allow-list building blocks every normaliser uses |
| `sections/vessel.js`             | `normaliseVesselSelection(input)` → `{ id }`                                                                                        |
| `sections/trip.js`               | `normaliseTrip(input)`                                                                                                              |
| `sections/pair-fishing.js`       | `normalisePairFishing(input)`                                                                                                       |
| `sections/gears.js`              | `normaliseGears(input)` — the per-gear hierarchy                                                                                    |
| `sections/species-not-landed.js` | `normaliseSpeciesNotLanded(input)` — the root-level, trip-level collection                                                          |
| `catch-record.js`                | `normaliseCatchRecord(input)` — composes every section above                                                                        |

## The one policy: explicit allow-listing, never spreading

Every normaliser builds its output by copying named fields explicitly (`copyField`) — it never spreads
an input object into output. A field not on a normaliser's allow-list is **omitted**, whether it is:

- genuinely unknown input,
- a client-supplied reference-data display snapshot (any `*Snapshot`-named field — these are resolved
  server-side only, canonical doc §4.5, never trusted from a client), or
- an attempted override of a server-owned field (`schemaVersion`, `id`, `catchRecordReference`,
  `ownerUserId`, `status`, `version`, `numberOfSubmissions`, `hasUnsubmittedChanges`, `artifacts`, or any
  audit/submission/completion timestamp or actor).

This single mechanism satisfies "unknown fields must not silently enter canonical output" and
"server-owned fields cannot be overwritten" identically, with no second competing rejection pathway.
`normaliseCatchRecord`'s output can only ever contain the five approved client-owned sections (`vessel`,
`trip`, `pairFishing`, `gears`, `speciesNotLanded`) — a server-owned root key is never even read from
input.

## No silent correction

Only whitespace-trimming is performed on string values. No type coercion, date reformatting, default
substitution, or hierarchy repair happens. A malformed collection (e.g. `gears` sent as a string) is
passed through **unchanged** rather than coerced to `[]`, so the invalidity remains detectable by Step 07
instead of being hidden. Gear `associationId` is preserved if supplied and never generated, inferred, or
replaced. Species entries (`gears[].speciesCaught[]`, root-level `speciesNotLanded[]`) have no
association identity of their own — a species' own `id` is its natural key.

## Deep immutability

Every level a normaliser touches (gear, characteristic, statistical area, species entry, ports) is
rebuilt as a new plain object/array. No level reuses a nested input object/array reference, so mutating
normalised output can never affect the original input, and no deep-clone dependency was needed.

## Determinism and ordering

Equivalent input (including different key insertion order or a deep-cloned copy) always normalises to
an equal output. Collections preserve client order exactly — nothing is sorted, because no ordering rule
is approved by the canonical specification.

## Null / absence handling

`undefined` input to any normaliser returns `undefined` (section/field genuinely absent); `null` input
returns `null` (explicit absence preserved). Neither is converted to a default or to the other.

## Explicitly deferred (not implemented here)

- Reference Data Service validation and snapshot resolution (Step 15/16).
- Weight-field/`weightPrecision` type and enum validation (Step 25/27's gear and species-not-landed
  validators) — normalisation only trims strings and never coerces or rejects a value.
- Mobile complete-replacement orchestration (Step 30); persistence mapping; ID/association-ID
  generation; lifecycle and submission behaviour.

## Running the focused tests

```bash
npx vitest run src/catch-recording/normalization
```
