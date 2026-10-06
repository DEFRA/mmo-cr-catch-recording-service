# Catch Recording reference validation and snapshot resolution

> Produced by Phase 4, Step 16
> (`design/github-prompts/step-16-implement-reference-validation-and-snapshot-resolution.md`). Owned by
> `src/catch-recording/reference-data/`. The underlying decisions are recorded in
> [`docs/configuration-decisions.md`](./configuration-decisions.md) → "Phase 4 decisions (Steps 13-16)".

## Purpose

Composes Step 07's validation-result contract, the Step 14 vessel-access policy, and the Step 15
Reference Data Service client into the domain capability later business operations need: validate a
stable reference ID, confirm current active selection, validate the one relationship the Reference Data
Service actually supports, and resolve the approved canonical display snapshot — without persisting
anything or implementing a business operation.

## Three distinct outcome channels

| Channel             | Shape                                  | Example                                                                               |
| ------------------- | -------------------------------------- | ------------------------------------------------------------------------------------- |
| Business validation | Step 07 `{ valid, issues }` — returned | Missing/malformed ID, unknown or inactive reference, invalid relationship             |
| Authorisation       | `ApplicationError` — thrown            | Vessel-access denial (Step 14)                                                        |
| Dependency failure  | `ApplicationError` — thrown            | `UPSTREAM_TIMEOUT` / `DEPENDENCY_UNAVAILABLE` / `UPSTREAM_INVALID_RESPONSE` (Step 15) |

A Step 15 `RESOURCE_NOT_FOUND` is the one deliberate exception: it is translated into an
`INVALID_REFERENCE` business-validation issue, because an unknown authoritative reference **is** the
business outcome being validated — every other Step 15 error category is rethrown unchanged.

## Resolvers

| Function                                                                                               | Resource                                                                                     |
| ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| `resolvePort` / `resolveGear` / `resolveStatisticalArea` / `resolveSpecies` (`reference-resolvers.js`) | Port, gear, statistical area, species, by stable ID                                          |
| `resolveGearCharacteristic` (`reference-resolvers.js`)                                                 | A selected characteristic against an already-resolved gear                                   |
| `resolveVessel` (`vessel-resolution.js`)                                                               | Vessel, composed with the Step 14 access policy                                              |
| `resolveCatchDetailAttribute` (`catch-detail-attributes.js`)                                           | `LSC`/`BMS`/`DIS` — Catch Recording's own local catalogue, not a Reference Data Service call |

No generic `resolve(resourceType, id)` function exists — each resource type has its own named operation.

## Active-selection rules

Reused exactly from `docs/configuration-decisions.md`: vessel `status === 'active'`; gear/port/species a
boolean `active` field; statistical area has no active field at all (every resolved item is selectable).

## Vessel-access composition order

1. Validate the vessel ID primitive.
2. Resolve the authoritative vessel through Step 15.
3. Confirm current active selection.
4. Evaluate Step 14's `decideVesselAccess` using the supplied, already-trusted `accessibleVesselIds` fact.
5. Only now is the canonical vessel snapshot returned.

Vessel existence is never treated as proof of access; vessel access is never treated as proof of
existence — both must independently succeed, and vessel details are never returned before access is
confirmed.

## Relationship validation — recorded gap

Only **gear characteristic → gear** is implemented, because it is the only relationship with real
supporting data in the confirmed Reference Data Service schemas (Step 15's `getGearById` already resolves
`characteristics[]`). **Gear → statistical area** and **gear → species** relationships are explicitly
**not implemented** — neither the species nor statistical-area schema carries a gear-reference field.
This is a recorded gap, not a guess; a resolver-level check can be added later without touching any other
file if an approved Reference Data Service contract adds such a field.

## Snapshot resolution

Each resolver maps only the exact canonical `Snapshot` fields (`snapshot-mappers.js`), confirmed against
`canonical-catch-record-object.md` — never a raw Step 15 result, transport field, or unknown field.
Client-supplied snapshot values are never trusted; snapshots are resolved only from a
strictly-validated Step 15 result.

## Historical-snapshot preservation

`historical-snapshot.js`'s `preserveOrRefresh` is one small pure comparison, not a cache: given a
previous stable ID, its stored snapshot, and the next stable ID, it returns the stored snapshot unchanged
when the ID hasn't changed, or signals that fresh resolution is required when it has. It never calls the
Reference Data Service and never stores anything — the calling (later) operation decides when to invoke
it. Reading a Catch Record, or editing unrelated fields, must never trigger fresh resolution.

## What Step 16 does not do

- Catch Record persistence, draft creation, section saving, or any business operation.
- Amendment reconciliation.
- A second Reference Data Service client or a new endpoint shape.
- Caching of any kind.
