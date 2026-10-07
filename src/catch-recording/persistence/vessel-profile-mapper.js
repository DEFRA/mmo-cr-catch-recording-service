/**
 * The vessel-profile document ⇄ canonical representation mapper.
 *
 * A vessel profile has no document until its first favourite/skipper addition. `toCanonicalProfile`
 * always returns the same complete shape — defaulting every array to `[]` — whether a document was
 * actually found or the caller passed `null`. This lets every read path (list endpoints, and the
 * "already empty" branch of a remove) share one representation rather than distinguishing "no document
 * yet" from "document with empty arrays": the approved retention decision is that a profile is retained
 * indefinitely once created, but the two states are presented identically to a caller.
 *
 * Skipper documents are mapped to their public shape (`id`, `name`, `phoneNumber`, `email`) only —
 * `normalisedName` (the internal case-insensitive duplicate-detection key) and every audit field
 * (`createdAt`/`createdBy`/`updatedAt`/`updatedBy`) never leave persistence, matching the approved
 * skipper response-representation decision (`docs/configuration-decisions.md`).
 */

function mapStoredSkipper(skipper) {
  return Object.freeze({
    id: skipper.id,
    name: skipper.name,
    phoneNumber: skipper.phoneNumber ?? null,
    email: skipper.email ?? null
  })
}

/**
 * @param {{ _id: string, favouriteGearIds?: string[], favouriteSpeciesIds?: string[],
 *   favouritePortIds?: string[], skippers?: object[] } | null} document
 * @param {string} vesselId used when `document` is `null` (no profile has ever been created yet)
 * @returns {Readonly<{ vesselId: string, favouriteGearIds: ReadonlyArray<string>,
 *   favouriteSpeciesIds: ReadonlyArray<string>, favouritePortIds: ReadonlyArray<string>,
 *   skippers: ReadonlyArray<object> }>}
 */
export function toCanonicalProfile(document, vesselId) {
  return Object.freeze({
    vesselId: document?._id ?? vesselId,
    favouriteGearIds: Object.freeze([...(document?.favouriteGearIds ?? [])]),
    favouriteSpeciesIds: Object.freeze([
      ...(document?.favouriteSpeciesIds ?? [])
    ]),
    favouritePortIds: Object.freeze([...(document?.favouritePortIds ?? [])]),
    skippers: Object.freeze(
      (document?.skippers ?? []).map((skipper) => mapStoredSkipper(skipper))
    )
  })
}
