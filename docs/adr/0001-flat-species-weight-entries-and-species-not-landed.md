# 0001. Replace the landing/retained-species model with flat species-weight entries and a root-level speciesNotLanded collection

Date: 2026-02-09

## Status

Accepted

## Context

Phase 6, Step 27 ("landing intention and retained-catch consistency") required five prerequisite product
decisions before implementation could start: the allowed `landing.intention` enum values, the
`retainedSpecies[]` entry shape, the `notLandingDetails` shape, and how the two must stay consistent. A
targeted search of every approved plan, design, and prompt document in this repository (including
`design/architecture/canonical-catch-record-object.md`, which itself flagged its own sample as
internally inconsistent) confirmed none of these had ever been approved anywhere — they were genuinely
undecided product questions, not an implementation gap that evidence could resolve.

When escalated to the service owner, the answers did not resolve the original `landing`/`retainedSpecies`
questions — they revealed the service owner wanted a different model entirely. The existing
`gears[].speciesCaught[]` shape (`{ associationId, species: { id, ... }, catchDetails: [{ attributeId,
value, ... }] }`, built across Steps 23–25) modelled "species caught under a gear" as a synthetic
relationship with its own identity and an attached catalogue of catch-detail attributes
(`LSC`/`BMS`/`DIS`). The service owner's revised model instead:

- treats a species' own authoritative reference `id` as the natural key (at most one occurrence per
  gear), eliminating the need for a synthetic species-level `associationId` and its retain/new/rejected
  reconciliation algorithm;
- replaces the `catchDetails[]`/`attributeId` catalogue with three fixed, optional weight fields
  directly on the species entry (`weightAboveMinimumKg`, `weightBelowMinimumKg`,
  `weightLegallyDiscardedKg`) plus an optional `weightPrecision` (`wholeNumber` | `oneDecimalPlace`);
  and
- introduces a new root-level, trip-level `speciesNotLanded[]` collection for species caught but not
  landed (released, discarded, or otherwise not retained) — independent of `gears`, because this catch
  is not meaningfully tied to the gear that caught it.

This last point conflicts with the long-standing architecture rule "no root-level statistical-area or
species collections" (`design/architecture/canonical-catch-record-object.md` §4.4, carried through
Steps 05–07's canonical/normalisation/validation contracts). The service owner explicitly confirmed this
is an intentional, approved exception: that rule was always meant to apply only to **landed** species
(`gears[].speciesCaught`, which must stay tied to the gear that caught it), not to species that were
never landed at all.

## Decision

Replace the entire `landing`/`retainedSpecies`/`notLandingDetails` model with:

1. A flat `SpeciesWeightEntry` shape — `{ id, faoCodeSnapshot, nameSnapshot, weightAboveMinimumKg?,
weightBelowMinimumKg?, weightLegallyDiscardedKg?, weightPrecision? }` — used identically by both
   `gears[].speciesCaught[]` (landed, per-gear) and the new root-level `speciesNotLanded[]` (not landed,
   trip-level). Weight values are numbers, never strings. `weightPrecision` has exactly two approved
   values with no cross-validation against a weight's actual decimal places. The species snapshot uses
   the approved slim convention (`id` + `faoCodeSnapshot`/`nameSnapshot`), matching every other
   reference-data selection in this service — never the full Reference Data Service response shape.
2. A species entry's own `id` as its sole identity. There is no species-level `associationId` and no
   catch-detail attribute catalogue. A gear's `speciesCaught` save is a full, wholesale replacement
   (resolved fresh from the Reference Data Service, no reconciliation against a prior collection needed),
   exactly mirroring how `characteristics` has always been rebuilt on every gear save.
3. A new root-level `speciesNotLanded[]` section, added to the existing generic section-PATCH pipeline
   (`SECTION_ALLOW_LIST` in `save-catch-record-section.js`, `ARRAY_VALUED_SECTIONS` in
   `src/routes/catch-records.js`) alongside `gears`. Unlike `gears`, a `speciesNotLanded` save needs no
   prior read of the persisted record — like `trip`, it resolves every supplied entry fresh from the
   Reference Data Service and overwrites the collection wholesale.
4. An explicit, documented exception to "no root-level species collection": that rule continues to apply
   to **landed** species only. `speciesNotLanded` is root-level and trip-level by design.

This supersedes the species/catch-detail portions of Steps 23–26 (which have been reworked to match) and
changes Step 27's actual scope from "landing intention and retained-catch consistency" to "implement the
`speciesNotLanded` root section". Per DEFRA API-contract-stability guidance (§2 of
`.github/copilot-instructions.md`), this is recorded as a breaking change to the previously-drafted (but
not yet released/consumed) canonical shape: no external consumer has integrated against the prior
`landing`/`retainedSpecies`/`catchDetails` shape, so there is no published contract to version around,
but the change is called out here explicitly in case any draft client work assumed the prior shape.

## Consequences

### Positive

- Removes an entire unresolved product area (`landing.intention`, `retainedSpecies`,
  `notLandingDetails`) that had no approved values and would otherwise have blocked Step 27
  indefinitely.
- Simpler species model: one natural key (`id`), one shared entry shape reused by both collections, no
  synthetic relationship identity or reconciliation algorithm to maintain at the species level.
- `speciesNotLanded` as a root-level, trip-level collection correctly reflects that catch not landed is
  not tied to any one gear — modelling it under `gears` would have forced an arbitrary gear attribution.

### Negative / Trade-offs

- Introduces one explicit, documented exception to a previously-absolute "no root-level species
  collection" rule. Mitigated by scoping the exception precisely (landed species only) and recording it
  here and in `docs/configuration-decisions.md` / `design/architecture/canonical-catch-record-object.md`
  so it cannot be mistaken for an oversight.
- Discards the `catchDetails[]`/`attributeId` catalogue built in Step 25, including its locally-owned
  `LSC`/`BMS`/`DIS` codes (`docs/configuration-decisions.md`). Any future need for a fourth or
  differently-named weight concept would require a further canonical-contract change, not a catalogue
  addition.
- Required reworking Steps 23–26's already-implemented and already-tested species code; mitigated by a
  full re-test (1561 tests across 104 files passing after the rework) and updated documentation.

### Compliance & Governance

- DEFRA standard(s) referenced: API contract stability (§2, `.github/copilot-instructions.md`); secure
  boundary validation is unchanged (every species selection is still re-validated and re-resolved against
  the authoritative Reference Data Service at save time, never trusting a client-supplied snapshot).
- Governance exception: None — this is a pre-release canonical-contract change with no external
  consumer yet integrated, confirmed and approved directly by the service owner.
