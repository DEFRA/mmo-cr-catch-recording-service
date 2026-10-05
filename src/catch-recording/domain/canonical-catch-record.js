/**
 * @typedef {object} VesselSnapshot
 * @property {string} id - Stable authoritative vessel reference ID.
 * @property {string} rssSnapshot - Approved RSS display snapshot.
 * @property {string} nameSnapshot - Approved vessel-name display snapshot.
 * @property {string} externalMarkSnapshot - Approved external-mark display snapshot.
 * @property {number} [lengthOverallMetresSnapshot] - Approved length-overall display snapshot.
 */

/**
 * @typedef {object} Port
 * @property {string} id - Stable authoritative port reference ID.
 * @property {string} codeSnapshot - Approved port-code display snapshot.
 * @property {string} nameSnapshot - Approved port-name display snapshot.
 */

/**
 * @typedef {object} Trip
 * @property {boolean} startedAndFinishedToday - Trip-date decision.
 * @property {string} dateStarted - Canonical date representation (exact representation deferred).
 * @property {string} dateEnded - Canonical date representation (exact representation deferred).
 * @property {Port} departurePort
 * @property {Port} returnPort
 */

/**
 * Populated `pairVessel`/`pairSkipperName` shape when `enabled` is `true` is not resolved by the
 * approved documents (canonical-catch-record-object.md has no "enabled" example). Only the three
 * top-level field names are represented; do not invent a nested shape.
 *
 * @typedef {object} PairFishing
 * @property {boolean} enabled
 * @property {unknown} pairVessel - `null` when `enabled` is `false`; populated shape unresolved.
 * @property {unknown} pairSkipperName - `null` when `enabled` is `false`; populated shape unresolved.
 */

/**
 * @typedef {object} Characteristic
 * @property {string} characteristicId - Stable characteristic ID (not a closed catalogue).
 * @property {string} nameSnapshot - Approved display-name snapshot.
 * @property {number|string|boolean} value - Exact value type deferred (canonical doc §4.5/§6).
 * @property {string} [unitSnapshot] - Approved unit snapshot, when applicable.
 */

/**
 * @typedef {object} StatisticalArea
 * @property {string} id - Stable authoritative area reference ID.
 * @property {string} codeSnapshot - Approved area-code display snapshot.
 * @property {string} nameSnapshot - Approved area-name display snapshot.
 */

/**
 * @typedef {object} CatchDetail
 * @property {string} attributeId - Stable attribute ID (exact required attributes deferred, Step 25).
 * @property {string} nameSnapshot - Approved display-name snapshot.
 * @property {number|string|boolean} value - Exact value type deferred.
 * @property {string} [unitSnapshot] - Approved unit snapshot, when applicable.
 */

/**
 * A gear-to-species relationship. Belongs to exactly one {@link GearAssociation}. The same
 * authoritative species may appear independently under a different gear association.
 *
 * @typedef {object} SpeciesAssociation
 * @property {string} associationId - Stable ID for this gear-to-species relationship.
 * @property {object} species
 * @property {string} species.id - Stable authoritative species reference ID.
 * @property {string} species.faoCodeSnapshot - Approved FAO-code display snapshot.
 * @property {string} species.nameSnapshot - Approved species-name display snapshot.
 * @property {CatchDetail[]} catchDetails
 */

/**
 * One gear occurrence. The authoritative root for all gear-dependent data: characteristics,
 * statistical area, and species (with their catch details) belong to the gear association that
 * contains them, never to the Catch Record root. Updating one gear association must not modify
 * another.
 *
 * @typedef {object} GearAssociation
 * @property {string} associationId - Stable ID for this gear occurrence (distinct from `gear.id`).
 * @property {object} gear
 * @property {string} gear.id - Stable authoritative gear reference ID.
 * @property {string} gear.codeSnapshot - Approved gear-code display snapshot.
 * @property {string} gear.nameSnapshot - Approved gear-name display snapshot.
 * @property {Characteristic[]} characteristics
 * @property {StatisticalArea} [statisticalArea] - Exactly one when the gear is complete (Step 07+).
 * @property {SpeciesAssociation[]} speciesCaught
 */

/**
 * References an existing {@link GearAssociation} and {@link SpeciesAssociation} already present
 * under `gears`. Must never create an independent, authoritative species collection.
 *
 * @typedef {object} RetainedSpecies
 * @property {string} gearAssociationId - Must reference an existing `gears[].associationId`.
 * @property {string} speciesAssociationId - Must reference an existing `speciesCaught[].associationId`
 *   under that gear.
 * @property {object} species
 * @property {string} species.id
 * @property {string} species.faoCodeSnapshot
 * @property {string} species.nameSnapshot
 * @property {CatchDetail[]} [details]
 */

/**
 * Allowed `intention` enum values and the exact `retainedSpecies`/`notLandingDetails` content rules
 * are deferred to Step 27 (canonical doc §4.7/§6). Step 05 defines only the baseline shape and the
 * gear/species cross-reference requirement.
 *
 * @typedef {object} Landing
 * @property {unknown} intention - Allowed values unresolved; deferred to Step 27.
 * @property {RetainedSpecies[]} retainedSpecies
 * @property {unknown} notLandingDetails - Shape unresolved; deferred to Step 27.
 */

/**
 * Metadata only - JSON and PDF artifact bodies are stored separately in object storage, never
 * embedded here. Exact entry shape beyond this field boundary is deferred to Step 33.
 *
 * @typedef {object} ArtifactMetadata
 * @property {number} submissionNumber
 * @property {string} type - e.g. `'JSON_SNAPSHOT'` or `'PDF_RECEIPT'` (exact catalogue deferred).
 */

/**
 * The authoritative Canonical Catch Record Object v1. Represents the current mutable operational
 * record. Immutable submission snapshots and append-only history are separate artifacts, never
 * embedded here.
 *
 * @typedef {object} CatchRecord
 * @property {number} schemaVersion - Always {@link CANONICAL_SCHEMA_VERSION}. Server-owned.
 * @property {string} id - Stable internal resource identifier. Server-owned.
 * @property {string} catchRecordReference - Immutable user-friendly reference. Server-owned.
 * @property {string} ownerUserId - Trusted owner identity. Server-owned; never client-supplied.
 * @property {'DRAFT'|'SUBMITTED'|'COMPLETE'} status - See {@link PERSISTED_STATUSES}. Server-owned.
 * @property {number} version - Optimistic-concurrency version. Server-owned.
 * @property {number} numberOfSubmissions - Server-owned.
 * @property {boolean} hasUnsubmittedChanges - Server-owned.
 * @property {VesselSnapshot} vessel
 * @property {Trip} trip
 * @property {PairFishing} pairFishing
 * @property {GearAssociation[]} gears - One or more. The authoritative per-gear hierarchy root.
 * @property {Landing} landing
 * @property {ArtifactMetadata[]} artifacts - Server-owned. Metadata only.
 * @property {string} createdAt - Server-owned.
 * @property {string} createdBy - Server-owned.
 * @property {string} updatedAt - Server-owned.
 * @property {string} updatedBy - Server-owned.
 * @property {string|null} submittedAt - Server-owned. `null` before first submission.
 * @property {string|null} submittedBy - Server-owned. `null` before first submission.
 * @property {string|null} completedAt - Server-owned. `null` before completion.
 * @property {string|null} completedBy - Server-owned. `null` before completion.
 */

/**
 * The approved Canonical Catch Record Object schema version. Server-owned; must not be inferred from
 * package or API versions, and must not be client-supplied.
 */
export const CANONICAL_SCHEMA_VERSION = 1

/**
 * The approved, invariant subset of fields for a Catch Record that has never been submitted, taken
 * directly from `design/architecture/canonical-catch-record-object.md` §5 ("New draft"). Reusable by
 * Step 06 (first persistent draft creation) and later steps' tests. Frozen so a consumer cannot
 * mutate the shared constant.
 */
export const NEW_DRAFT_DEFAULTS = Object.freeze({
  numberOfSubmissions: 0,
  hasUnsubmittedChanges: false,
  artifacts: Object.freeze([]),
  submittedAt: null,
  submittedBy: null,
  completedAt: null,
  completedBy: null
})
