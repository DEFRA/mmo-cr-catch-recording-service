import { ApplicationError } from '#/common/helpers/errors/application-error.js'
import {
  resolveGear,
  resolveSpecies,
  resolvePort
} from '../reference-data/reference-resolvers.js'
import {
  findVesselProfile,
  addFavouriteId,
  removeFavouriteId
} from '../persistence/vessel-profile-persistence.js'
import {
  claimIdempotency,
  completeIdempotencyClaim,
  IDEMPOTENCY_CLAIM_OUTCOMES
} from '../persistence/catch-idempotency-persistence.js'
import { IDEMPOTENCY_OPERATION_SCOPES } from '../persistence/idempotency-operation-scope.js'
import { computeRequestFingerprint } from '../persistence/idempotency-fingerprint.js'
import {
  requireVesselId,
  trustedNowIso,
  enforceVesselProfileAccess
} from './vessel-profile-access.js'

/**
 * Step 39: vessel-scoped favourite gears/species/ports (`GET`/`POST`/`DELETE
 * /v1/vessels/{vesselId}/favourite-{gears|species|ports}[/{id}]`).
 *
 * One shared internal core (`listFavourites`/`addFavourite`/`removeFavourite`), parameterised by an
 * explicit, closed per-type configuration object — mirroring `reference-resolvers.js`'s
 * `resolveReference` core shared by `resolveGear`/`resolveSpecies`/`resolvePort`. Every exported function
 * is a thin, explicitly-named wrapper; there is no dynamic/generic `manageFavourite(type, ...)` entry
 * point.
 *
 * Favourites are returned and stored as stable reference IDs only — never a stored or re-resolved
 * snapshot (`docs/configuration-decisions.md` "Phase 9 decisions"). `$addToSet`/atomic-pull in
 * `vessel-profile-persistence.js` is the complete duplicate-prevention and idempotent-addition/safe-
 * removal mechanism; the optional `Idempotency-Key` header (reusing the already-approved `ADD_FAVOURITE`
 * scope) only additionally lets a retried request skip a redundant Reference Data Service call.
 */

const GEAR_CONFIG = Object.freeze({
  field: 'favouriteGearIds',
  resolveReference: resolveGear,
  resourceLabel: 'gear',
  idempotencyResourceSuffix: 'gear'
})

const SPECIES_CONFIG = Object.freeze({
  field: 'favouriteSpeciesIds',
  resolveReference: resolveSpecies,
  resourceLabel: 'species',
  idempotencyResourceSuffix: 'species'
})

const PORT_CONFIG = Object.freeze({
  field: 'favouritePortIds',
  resolveReference: resolvePort,
  resourceLabel: 'port',
  idempotencyResourceSuffix: 'port'
})

function requireFavouriteId(id, resourceLabel) {
  if (typeof id !== 'string' || id.trim().length === 0) {
    throw new ApplicationError({
      category: 'INVALID_REQUEST',
      code: 'FAVOURITE_ID_REQUIRED',
      message: `A ${resourceLabel} id is required.`
    })
  }
}

function invalidFavouriteSelectionError(resourceLabel, result) {
  return new ApplicationError({
    category: 'BUSINESS_VALIDATION_FAILURE',
    code: 'INVALID_FAVOURITE_SELECTION',
    message:
      result.issues[0]?.message ?? `The selected ${resourceLabel} is invalid.`,
    details: result.issues
  })
}

async function listFavourites({
  db,
  referenceDataClient,
  authenticationContext,
  vesselId,
  correlationId,
  field
}) {
  requireVesselId(vesselId)
  await enforceVesselProfileAccess({
    vesselId,
    referenceDataClient,
    authenticationContext,
    correlationId
  })

  const profile = await findVesselProfile(db, vesselId)

  return Object.freeze({ vesselId: profile.vesselId, [field]: profile[field] })
}

async function claimFavouriteAddition({
  db,
  ownerUserId,
  vesselId,
  id,
  idempotencyKey,
  idempotencyResourceSuffix
}) {
  const fingerprint = computeRequestFingerprint({
    operationScope: IDEMPOTENCY_OPERATION_SCOPES.ADD_FAVOURITE,
    idempotencyKey,
    allowedFields: ['vesselId', 'id'],
    semanticInput: { vesselId, id }
  })
  const resourceId = `${vesselId}:${idempotencyResourceSuffix}`

  const claim = await claimIdempotency(db, {
    ownerUserId,
    operationScope: IDEMPOTENCY_OPERATION_SCOPES.ADD_FAVOURITE,
    idempotencyKey,
    resourceId,
    fingerprint
  })

  if (claim.outcome === IDEMPOTENCY_CLAIM_OUTCOMES.IN_PROGRESS) {
    throw new ApplicationError({
      category: 'IDEMPOTENCY_CONFLICT',
      code: 'IDEMPOTENCY_REQUEST_IN_PROGRESS',
      message: 'An identical request is already being processed.'
    })
  }

  return { fingerprint, resourceId, claim }
}

async function completeFavouriteAddition({
  db,
  ownerUserId,
  idempotencyKey,
  resourceId,
  fingerprint,
  id
}) {
  await completeIdempotencyClaim(db, {
    ownerUserId,
    operationScope: IDEMPOTENCY_OPERATION_SCOPES.ADD_FAVOURITE,
    idempotencyKey,
    resourceId,
    fingerprint,
    result: { id },
    allowedResultFields: ['id']
  })
}

async function addFavourite({
  db,
  referenceDataClient,
  authenticationContext,
  vesselId,
  id,
  idempotencyKey,
  correlationId,
  field,
  resolveReference,
  resourceLabel,
  idempotencyResourceSuffix
}) {
  requireVesselId(vesselId)
  requireFavouriteId(id, resourceLabel)
  await enforceVesselProfileAccess({
    vesselId,
    referenceDataClient,
    authenticationContext,
    correlationId
  })

  const ownerUserId = authenticationContext?.userId

  let idempotency
  let skipReferenceValidation = false

  if (idempotencyKey) {
    idempotency = await claimFavouriteAddition({
      db,
      ownerUserId,
      vesselId,
      id,
      idempotencyKey,
      idempotencyResourceSuffix
    })
    skipReferenceValidation =
      idempotency.claim.outcome === IDEMPOTENCY_CLAIM_OUTCOMES.REPLAY
  }

  if (!skipReferenceValidation) {
    const { result } = await resolveReference({
      id,
      path: [resourceLabel],
      client: referenceDataClient,
      correlationId
    })

    if (!result.valid) {
      throw invalidFavouriteSelectionError(resourceLabel, result)
    }
  }

  const profile = await addFavouriteId(db, {
    vesselId,
    field,
    id,
    actorUserId: ownerUserId,
    now: trustedNowIso()
  })

  if (
    idempotencyKey &&
    idempotency.claim.outcome === IDEMPOTENCY_CLAIM_OUTCOMES.CLAIMED
  ) {
    await completeFavouriteAddition({
      db,
      ownerUserId,
      idempotencyKey,
      resourceId: idempotency.resourceId,
      fingerprint: idempotency.fingerprint,
      id
    })
  }

  return Object.freeze({ vesselId: profile.vesselId, [field]: profile[field] })
}

async function removeFavourite({
  db,
  referenceDataClient,
  authenticationContext,
  vesselId,
  id,
  correlationId,
  field,
  resourceLabel
}) {
  requireVesselId(vesselId)
  requireFavouriteId(id, resourceLabel)
  await enforceVesselProfileAccess({
    vesselId,
    referenceDataClient,
    authenticationContext,
    correlationId
  })

  await removeFavouriteId(db, {
    vesselId,
    field,
    id,
    actorUserId: authenticationContext?.userId,
    now: trustedNowIso()
  })
}

export function listFavouriteGears(input) {
  return listFavourites({ ...input, ...GEAR_CONFIG })
}

export function addFavouriteGear(input) {
  return addFavourite({ ...input, id: input.gearId, ...GEAR_CONFIG })
}

export function removeFavouriteGear(input) {
  return removeFavourite({ ...input, id: input.gearId, ...GEAR_CONFIG })
}

export function listFavouriteSpecies(input) {
  return listFavourites({ ...input, ...SPECIES_CONFIG })
}

export function addFavouriteSpecies(input) {
  return addFavourite({ ...input, id: input.speciesId, ...SPECIES_CONFIG })
}

export function removeFavouriteSpecies(input) {
  return removeFavourite({ ...input, id: input.speciesId, ...SPECIES_CONFIG })
}

export function listFavouritePorts(input) {
  return listFavourites({ ...input, ...PORT_CONFIG })
}

export function addFavouritePort(input) {
  return addFavourite({ ...input, id: input.portId, ...PORT_CONFIG })
}

export function removeFavouritePort(input) {
  return removeFavourite({ ...input, id: input.portId, ...PORT_CONFIG })
}
