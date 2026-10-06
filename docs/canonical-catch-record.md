# Canonical Catch Record Object v1

> Produced by Phase 2, Step 05
> (`design/github-prompts/step-05-implement-canonical-catch-record-object-v1.md`), implementing
> `design/architecture/canonical-catch-record-object.md` exactly. This is a focused reference — see
> that document and
> [`design/architecture/catch-recording-service-design.md`](../design/architecture/catch-recording-service-design.md)
> §§7–9 for the full authoritative design. See
> [`catch-recording-modules.md`](./catch-recording-modules.md) for module ownership.

## Purpose and ownership

The **canonical domain contract** (`src/catch-recording/domain/`) owns the approved field names,
canonical hierarchy, canonical constants/enums, lifecycle fields, and metadata shape of the Catch
Record. It does not own HTTP, persistence, external services, or orchestration — those are later steps'
responsibility, built _against_ this contract rather than redefining it.

| File                                                                         | Exports                                                                             |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `src/catch-recording/domain/canonical-catch-record.js`                       | JSDoc typedefs for the full shape; `CANONICAL_SCHEMA_VERSION`; `NEW_DRAFT_DEFAULTS` |
| `src/catch-recording/domain/lifecycle-status.js`                             | `PERSISTED_STATUSES`; `isPersistedStatus(value)`                                    |
| `src/catch-recording/domain/server-owned-fields.js`                          | `SERVER_OWNED_FIELDS`; `isServerOwnedField(fieldName)`                              |
| `src/catch-recording/domain/__fixtures__/canonical-catch-record.fixtures.js` | `newDraftExample`, `submittedExample`, `amendedDraftExample`, `completeExample`     |

All three production files are framework-neutral: no import of Hapi, Boom, Joi, or MongoDB (verified by
`architecture-boundary.test.js` and a manual `grep`).

## Schema version

`CANONICAL_SCHEMA_VERSION = 1`. Server-owned; never inferred from package/API versions, never
client-supplied. Step 05 defines no migration behaviour and no second schema version.

## Persisted statuses

Only `DRAFT`, `SUBMITTED`, and `COMPLETE` are ever persisted (`PERSISTED_STATUSES`,
`isPersistedStatus`). `DRAFT_EDIT`, `AMENDED`, `ABANDONED`, and `WITHDRAWN` are never valid persisted
values. **Amended** is a derived display state only — `status === 'DRAFT' && numberOfSubmissions > 0` —
calculated by Step 08, never stored.

## Canonical hierarchy

```text
Catch Record
├── gears[] (GearAssociation, one or more)
│   ├── characteristics[]
│   ├── statisticalArea (exactly one when complete)
│   └── speciesCaught[] (SpeciesWeightEntry) — landed species, per gear
└── speciesNotLanded[] (SpeciesWeightEntry) — root-level, trip-level, not tied to any gear
```

- `gears[].associationId` is a **relationship identity**, distinct from the authoritative reference ID
  (`gear.id`). A species entry's own `id` (the authoritative species reference ID) is its natural key —
  there is no separate species-level `associationId`, and at most one occurrence of a given species `id`
  may exist per gear (or, independently, per `speciesNotLanded` collection).
- Characteristics and statistical area belong to their containing gear association — there is no
  root-level `statisticalArea`.
- The same authoritative species may appear independently under more than one gear association, and
  independently again under `speciesNotLanded`.
- `speciesNotLanded` is root-level and trip-level by design — the one approved exception to the "no
  root-level species collection" rule, which otherwise applies only to **landed** species
  (`gears[].speciesCaught`). It exists because species caught but not landed are not meaningfully tied
  to the gear that caught them.
- Both `speciesCaught` entries and `speciesNotLanded` entries share the same shape: `id`, a slim
  `faoCodeSnapshot`/`nameSnapshot` species snapshot, and the optional weight fields
  `weightAboveMinimumKg`, `weightBelowMinimumKg`, `weightLegallyDiscardedKg` (numbers, never strings)
  plus an optional `weightPrecision` (`wholeNumber` | `oneDecimalPlace`). There is no `catchDetails[]`/
  `attributeId` catalogue.

## Server-owned fields

One source of truth: `SERVER_OWNED_FIELDS` /
`isServerOwnedField(fieldName)`. Clients must never be able to set or overwrite:
`schemaVersion`, `id`, `catchRecordReference`, `ownerUserId`, `status`, `version`,
`numberOfSubmissions`, `hasUnsubmittedChanges`, `artifacts`, `createdAt`, `createdBy`, `updatedAt`,
`updatedBy`, `submittedAt`, `submittedBy`, `completedAt`, `completedBy`. Step 06 is the module that
enforces this list; Step 05 only defines it.

## Derived values (never persisted)

Display status, completed/incomplete sections, incomplete gear-association IDs, all-gears-complete
indicator, submission eligibility, and any frontend route/screen/navigation data are **not** part of the
canonical contract. They are calculated on demand by Step 08 (lifecycle/display status) and later query
steps.

## Operational record vs. history vs. artifacts

The canonical object is the **current mutable operational record** only:

- `artifacts[]` holds metadata about committed immutable submission versions (e.g.
  `{ submissionNumber, type }`) — JSON/PDF bodies are stored separately in object storage, never
  embedded.
- Lifecycle/edit/submission/completion **events** belong to the separate append-only history mechanism
  (Phase 3) — never embedded as a growing collection here.

## Explicitly deferred (represented structurally only)

- `pairFishing.pairVessel` / `pairFishing.pairSkipperName` populated shape when `enabled` is `true` —
  only the three field names are represented.
- Exact gear-characteristic `value` type and `unitSnapshot` validation — deferred; JSDoc marks
  `value` as `number | string | boolean`.
- Artifact metadata entry shape beyond `{ submissionNumber, type }` — Step 33.
- Friendly-reference generation, internal ID generation, timestamp generation, actor resolution — not
  implemented by this contract; it only names the fields that later steps populate.

## Using the fixtures in later steps

`__fixtures__/canonical-catch-record.fixtures.js` exports four deep-frozen, synthetic, structurally
valid examples (`newDraftExample`, `submittedExample`, `amendedDraftExample`, `completeExample`) for
reuse by Steps 06–08's tests, avoiding duplicated literal fixtures across the phase. They are
structural examples only — they do not encode later-step business-validation outcomes as "valid".

## Running the focused tests

```bash
npx vitest run src/catch-recording/domain
```
