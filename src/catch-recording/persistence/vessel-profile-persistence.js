import { getVesselProfileCollection } from './vessel-profile-collection.js'
import { toCanonicalProfile } from './vessel-profile-mapper.js'
import { assertPlainString } from './persistence-guards.js'
import {
  isDuplicateProfileKeyError,
  malformedVesselProfileDocumentError,
  unexpectedVesselProfilePersistenceError
} from './vessel-profile-errors.js'

export { ensureVesselProfileIndexes } from './vessel-profile-collection.js'

/**
 * `VesselProfilePersistence`: the sole Catch Recording owner of vessel-profile (favourites/skippers)
 * MongoDB access (Step 39, part of the `CatchPersistence` ownership area approved by
 * `docs/catch-recording-modules.md`).
 *
 * A vessel profile is keyed by the authoritative vessel ID itself (`_id`). Every mutation is one atomic
 * `findOneAndUpdate` — never a read-then-write, never an application-level check-then-insert — matching
 * the approved no-read-then-write persistence convention already used throughout `catch-persistence.js`
 * and `catch-idempotency-persistence.js`.
 *
 * Does not implement: routes, authentication/authorisation, reference-data validation, idempotency
 * claims, Catch Record access, or any business orchestration — those are the calling controller's
 * responsibility. See `docs/catch-recording-vessel-profiles.md` for the full contract.
 */

/** The one retry this module ever performs — see `attemptAddSkipper`'s docstring. */
const MAX_SKIPPER_ADD_ATTEMPTS = 2

/** The approved empty-profile defaults (`docs/configuration-decisions.md` "Phase 9 decisions") — used
 * only by `$setOnInsert` clauses, and always with the field currently being mutated removed from the
 * object first (an insert-time default and the same update's own mutation operator can never target the
 * same field path in one MongoDB update document). */
const EMPTY_FAVOURITE_ARRAYS = Object.freeze({
  favouriteGearIds: [],
  favouriteSpeciesIds: [],
  favouritePortIds: []
})

function mapStoredDocument(document, vesselId) {
  try {
    return toCanonicalProfile(document, vesselId)
  } catch (cause) {
    throw malformedVesselProfileDocumentError(cause)
  }
}

function setOnInsertFavouritesExcluding(field) {
  return Object.fromEntries(
    Object.entries(EMPTY_FAVOURITE_ARRAYS).filter(([key]) => key !== field)
  )
}

/**
 * Retrieves the canonical vessel profile. Vessel access is not re-checked here — the calling controller
 * must already have enforced `decideVesselProfileAccess` before this is ever invoked; this primitive has
 * no owner concept distinct from vessel access. Returns the approved default empty profile when no
 * document has ever been created — never `null`, never a not-found error. "No favourites or skippers
 * yet" is a valid state, not a missing resource.
 *
 * @param {import('mongodb').Db} db
 * @param {string} vesselId
 * @returns {Promise<object>} The canonical vessel profile.
 */
export async function findVesselProfile(db, vesselId) {
  assertPlainString(vesselId, 'vesselId')
  const collection = getVesselProfileCollection(db)

  let document
  try {
    document = await collection.findOne({ _id: vesselId })
  } catch (error) {
    throw unexpectedVesselProfilePersistenceError(error)
  }

  return mapStoredDocument(document, vesselId)
}

/**
 * Atomically adds one favourite reference ID to the named favourite array. `$addToSet` is itself the
 * complete duplicate-prevention and idempotency mechanism — adding an ID already present is a no-op that
 * still returns the current profile with a `200`-equivalent success outcome; no separate "already
 * exists" branch is needed. `upsert: true` creates the profile document on first use.
 *
 * @param {import('mongodb').Db} db
 * @param {{ vesselId: string, field: 'favouriteGearIds'|'favouriteSpeciesIds'|'favouritePortIds',
 *   id: string, actorUserId: string, now: string }} params
 * @returns {Promise<object>} The updated canonical vessel profile.
 */
export async function addFavouriteId(
  db,
  { vesselId, field, id, actorUserId, now }
) {
  assertPlainString(vesselId, 'vesselId')
  assertPlainString(field, 'field')
  assertPlainString(id, 'id')
  assertPlainString(actorUserId, 'actorUserId')
  assertPlainString(now, 'now')

  const collection = getVesselProfileCollection(db)

  let document
  try {
    document = await collection.findOneAndUpdate(
      { _id: vesselId },
      {
        $addToSet: { [field]: id },
        $setOnInsert: {
          _id: vesselId,
          ...setOnInsertFavouritesExcluding(field),
          skippers: [],
          createdAt: now,
          createdBy: actorUserId
        },
        $set: { updatedAt: now, updatedBy: actorUserId }
      },
      { upsert: true, returnDocument: 'after' }
    )
  } catch (error) {
    throw unexpectedVesselProfilePersistenceError(error)
  }

  return mapStoredDocument(document, vesselId)
}

/**
 * Atomically removes one favourite reference ID. Never `upsert`s — removal must never create a profile.
 * Safe no-op (returns the approved default/current profile unchanged) when the profile does not exist,
 * or when the ID is already absent from the array.
 *
 * @param {import('mongodb').Db} db
 * @param {{ vesselId: string, field: 'favouriteGearIds'|'favouriteSpeciesIds'|'favouritePortIds',
 *   id: string, actorUserId: string, now: string }} params
 * @returns {Promise<object>} The updated canonical vessel profile.
 */
export async function removeFavouriteId(
  db,
  { vesselId, field, id, actorUserId, now }
) {
  assertPlainString(vesselId, 'vesselId')
  assertPlainString(field, 'field')
  assertPlainString(id, 'id')
  assertPlainString(actorUserId, 'actorUserId')
  assertPlainString(now, 'now')

  const collection = getVesselProfileCollection(db)

  let document
  try {
    document = await collection.findOneAndUpdate(
      { _id: vesselId },
      {
        $pull: { [field]: id },
        $set: { updatedAt: now, updatedBy: actorUserId }
      },
      { returnDocument: 'after' }
    )
  } catch (error) {
    throw unexpectedVesselProfilePersistenceError(error)
  }

  return mapStoredDocument(document, vesselId)
}

function buildSkipperDocument({
  id,
  name,
  normalisedName,
  phoneNumber,
  email,
  actorUserId,
  now
}) {
  return {
    id,
    name,
    normalisedName,
    phoneNumber: phoneNumber ?? null,
    email: email ?? null,
    createdAt: now,
    createdBy: actorUserId,
    updatedAt: now,
    updatedBy: actorUserId
  }
}

function hasMatchingSkipper(document, normalisedName) {
  return (document?.skippers ?? []).some(
    (skipper) => skipper.normalisedName === normalisedName
  )
}

/**
 * Atomically adds one skipper, using a `{ _id, 'skippers.normalisedName': { $ne } }` filter + `$push` +
 * `upsert: true` — the same "atomic array-dedupe push" shape `addFavouriteId` gets for free from
 * `$addToSet`, needed explicitly here because the duplicate key (`normalisedName`, case-insensitive) is
 * not the stored array element itself (the stored element is a full skipper object).
 *
 * A resulting duplicate-key error on `_id` has exactly one of two causes, disambiguated by one follow-up
 * read: (1) the named skipper genuinely already exists on this vessel (the filter's `$ne` correctly
 * excluded the existing document, so the attempted upsert-insert collided with the vessel's own `_id`) —
 * treated as an idempotent duplicate, returning the current profile; or (2) a concurrent request created
 * the profile document for the first time between this attempt's filter evaluation and its insert,
 * purely a profile-creation race unrelated to any name collision — resolved by retrying the identical
 * update exactly once more, now that the profile document exists and the same filter can correctly
 * evaluate its `$ne` condition instead of attempting a second insert. `MAX_SKIPPER_ADD_ATTEMPTS` bounds
 * this to a single retry — mirroring the bounded-recursion pattern already used by
 * `authentication-client.js`'s `validateWithRetry`.
 */
async function attemptAddSkipper(
  collection,
  { vesselId, skipperDocument, normalisedName, actorUserId, now },
  attempt
) {
  let document
  try {
    document = await collection.findOneAndUpdate(
      { _id: vesselId, 'skippers.normalisedName': { $ne: normalisedName } },
      {
        $push: { skippers: skipperDocument },
        $setOnInsert: {
          _id: vesselId,
          ...EMPTY_FAVOURITE_ARRAYS,
          createdAt: now,
          createdBy: actorUserId
        },
        $set: { updatedAt: now, updatedBy: actorUserId }
      },
      { upsert: true, returnDocument: 'after' }
    )
  } catch (error) {
    if (!isDuplicateProfileKeyError(error)) {
      throw unexpectedVesselProfilePersistenceError(error)
    }

    let existing
    try {
      existing = await collection.findOne({ _id: vesselId })
    } catch (readError) {
      throw unexpectedVesselProfilePersistenceError(readError)
    }

    if (hasMatchingSkipper(existing, normalisedName)) {
      return existing
    }

    if (attempt >= MAX_SKIPPER_ADD_ATTEMPTS) {
      throw unexpectedVesselProfilePersistenceError(error)
    }

    return attemptAddSkipper(
      collection,
      { vesselId, skipperDocument, normalisedName, actorUserId, now },
      attempt + 1
    )
  }

  return document
}

/**
 * Adds one vessel-owned skipper, enforcing the approved case-insensitive trimmed-name duplicate rule.
 * Repeating an add with the same (normalised) name is idempotent — it returns the current profile
 * unchanged, never an error (`docs/configuration-decisions.md` "Phase 9 decisions").
 *
 * @param {import('mongodb').Db} db
 * @param {{ vesselId: string, skipperId: string, name: string, phoneNumber?: string|null,
 *   email?: string|null, actorUserId: string, now: string }} params
 * @returns {Promise<object>} The updated canonical vessel profile.
 */
export async function addSkipper(
  db,
  { vesselId, skipperId, name, phoneNumber, email, actorUserId, now }
) {
  assertPlainString(vesselId, 'vesselId')
  assertPlainString(skipperId, 'skipperId')
  assertPlainString(name, 'name')
  assertPlainString(actorUserId, 'actorUserId')
  assertPlainString(now, 'now')

  const normalisedName = name.trim().toLowerCase()
  const collection = getVesselProfileCollection(db)
  const skipperDocument = buildSkipperDocument({
    id: skipperId,
    name,
    normalisedName,
    phoneNumber,
    email,
    actorUserId,
    now
  })

  const document = await attemptAddSkipper(
    collection,
    { vesselId, skipperDocument, normalisedName, actorUserId, now },
    1
  )

  return mapStoredDocument(document, vesselId)
}

/**
 * Atomically removes one vessel-owned skipper by ID. Safe no-op when the profile or skipper is already
 * absent.
 *
 * @param {import('mongodb').Db} db
 * @param {{ vesselId: string, skipperId: string, actorUserId: string, now: string }} params
 * @returns {Promise<object>} The updated canonical vessel profile.
 */
export async function removeSkipper(
  db,
  { vesselId, skipperId, actorUserId, now }
) {
  assertPlainString(vesselId, 'vesselId')
  assertPlainString(skipperId, 'skipperId')
  assertPlainString(actorUserId, 'actorUserId')
  assertPlainString(now, 'now')

  const collection = getVesselProfileCollection(db)

  let document
  try {
    document = await collection.findOneAndUpdate(
      { _id: vesselId },
      {
        $pull: { skippers: { id: skipperId } },
        $set: { updatedAt: now, updatedBy: actorUserId }
      },
      { returnDocument: 'after' }
    )
  } catch (error) {
    throw unexpectedVesselProfilePersistenceError(error)
  }

  return mapStoredDocument(document, vesselId)
}
