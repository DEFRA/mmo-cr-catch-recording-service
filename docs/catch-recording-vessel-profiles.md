# Vessel Favourites and Skippers (Step 39)

> Produced by Phase 9, Step 39
> (`design/github-prompts/step-39-implement-vessel-favourites-and-skippers.md`). See
> `docs/configuration-decisions.md` → "Phase 9 decisions (Step 39)" for every resolved decision this
> document assumes.

## Concept

A vessel profile is local, vessel-owned Catch Recording convenience data associated with an authoritative
vessel ID. It is never the authoritative vessel record itself, and it never modifies an existing Catch
Record:

```text
Vessel Catch Recording Profile
├── vesselId
├── favouriteGearIds
├── favouriteSpeciesIds
├── favouritePortIds
└── skippers
```

## Endpoints

```http
GET    /v1/vessels/{vesselId}/favourite-gears
POST   /v1/vessels/{vesselId}/favourite-gears
DELETE /v1/vessels/{vesselId}/favourite-gears/{gearId}

GET    /v1/vessels/{vesselId}/favourite-species
POST   /v1/vessels/{vesselId}/favourite-species
DELETE /v1/vessels/{vesselId}/favourite-species/{speciesId}

GET    /v1/vessels/{vesselId}/favourite-ports
POST   /v1/vessels/{vesselId}/favourite-ports
DELETE /v1/vessels/{vesselId}/favourite-ports/{portId}

GET    /v1/vessels/{vesselId}/skippers
POST   /v1/vessels/{vesselId}/skippers
DELETE /v1/vessels/{vesselId}/skippers/{skipperId}
```

No skipper update endpoint exists (deferred — see `docs/configuration-decisions.md`).

Every endpoint requires the trusted `authentication-service` strategy and enforces vessel-profile
authorisation (`decideVesselProfileAccess`, reusing the Step 14 `decideVesselAccess` gate unchanged) —
`accessibleVesselIds` comes from `referenceDataClient.listAccessibleVesselIds`, exactly as Step 18's draft
creation already does.

## Request/response contracts

- **Favourites** are stored and returned as stable reference IDs only (`favouriteGearIds`/
  `favouriteSpeciesIds`/`favouritePortIds`) — never a stored or re-resolved snapshot. `GET` returns
  `{ vesselId, favourite<Type>Ids }`. `POST` accepts the ID in the payload (e.g. `{ "gearId": "..." }`,
  not the URL path), validates it against the Reference Data Service (`resolveGear`/`resolveSpecies`/
  `resolvePort`, requiring the reference to be active/selectable), and returns `200 OK` with the same
  shape as `GET` — idempotently, whether or not the ID was already present. `DELETE` always returns `204
No Content`, whether or not the ID was present.
- **Skippers** are vessel-owned local entries: `{ id, name, phoneNumber, email }` in every response —
  `id` is always server-generated (`randomUUID()`), never client-supplied. `POST` accepts
  `{ name, phoneNumber?, email? }` and returns `200 OK` with `{ vesselId, skippers }` — idempotently for a
  case-insensitive, trimmed duplicate `name` on the same vessel (the existing skipper is returned
  unchanged, not an error). `DELETE` always returns `204 No Content`.
- An optional `Idempotency-Key` header is accepted on every `POST` (reusing the `ADD_FAVOURITE`/
  `ADD_SKIPPER` scopes already defined in `idempotency-operation-scope.js`), mirroring the optional-header
  pattern used throughout the service since Step 18. It is never required — atomic, duplicate-safe
  persistence (see below) is itself the complete duplicate-prevention and idempotent-addition mechanism.

## Persistence

`src/catch-recording/persistence/vessel-profile-persistence.js` is the sole MongoDB owner of the
`vessel-profiles` collection (one document per vessel, keyed by `_id = vesselId`):

- **Favourite add** is one atomic `findOneAndUpdate` using `$addToSet` with `upsert: true` — `$addToSet`
  is itself the complete duplicate-prevention and idempotency mechanism; no read-then-write is ever
  performed.
- **Favourite remove** is one atomic `findOneAndUpdate` using `$pull`, never `upsert` — safe no-op when
  the profile or the ID does not exist.
- **Skipper add** is one atomic `findOneAndUpdate` filtering on `{ _id, 'skippers.normalisedName': { $ne
} }` with `$push` and `upsert: true` — the same "atomic array-dedupe push" shape `$addToSet` gets for
  free, needed explicitly because the duplicate key (`normalisedName`) is not the stored array element
  itself. A resulting MongoDB duplicate-key error is disambiguated by one follow-up read into either "the
  named skipper already exists" (idempotent — return the current profile) or "a concurrent request
  created the profile for the first time" (a bounded, single retry of the identical update).
- **Skipper remove** is one atomic `findOneAndUpdate` using `$pull` by `id`, never `upsert`.
- A vessel profile is retained indefinitely, including when empty — no TTL index, no purge on vessel
  inactivity or access-loss.

## Explicit exclusions

No global skipper identity, search, or cross-vessel deduplication; no skipper authentication/account
linkage; no automatic mutation of any existing Catch Record; no modification of global gear/species/
port/vessel reference data; no favourite statistical areas; no application cache.
