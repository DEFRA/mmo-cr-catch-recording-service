import { randomUUID } from 'node:crypto'

import {
  findVesselProfile,
  addSkipper as persistAddSkipper,
  removeSkipper as persistRemoveSkipper
} from '../persistence/vessel-profile-persistence.js'
import {
  claimIdempotency,
  completeIdempotencyClaim,
  IDEMPOTENCY_CLAIM_OUTCOMES
} from '../persistence/catch-idempotency-persistence.js'
import { IDEMPOTENCY_OPERATION_SCOPES } from '../persistence/idempotency-operation-scope.js'
import { computeRequestFingerprint } from '../persistence/idempotency-fingerprint.js'
import { ApplicationError } from '#/common/helpers/errors/application-error.js'
import {
  requireVesselId,
  trustedNowIso,
  enforceVesselProfileAccess
} from './vessel-profile-access.js'

/**
 * Step 39: vessel-owned skippers (`GET`/`POST`/`DELETE /v1/vessels/{vesselId}/skippers[/{id}]`).
 *
 * No update endpoint — resolved (`docs/configuration-decisions.md` "Phase 9 decisions"): no
 * authoritative UI contract confirms update is required.
 *
 * Skippers are local vessel-owned entries only — no global skipper identity, cross-vessel deduplication,
 * or authentication/account linkage. Duplicate prevention is case-insensitive, trimmed exact `name`
 * matching within the same vessel, enforced atomically by `vessel-profile-persistence.js` (never an
 * application-level check-then-insert). The `id` returned to callers is server-generated
 * (`randomUUID()`) — never client-supplied, mirroring `create-draft-catch-record.js`'s own-ID-generation
 * convention.
 */

function requireSkipperName(name) {
  if (typeof name !== 'string' || name.trim().length === 0) {
    throw new ApplicationError({
      category: 'INVALID_REQUEST',
      code: 'SKIPPER_NAME_REQUIRED',
      message: 'A skipper name is required.'
    })
  }
}

function requireSkipperId(skipperId) {
  if (typeof skipperId !== 'string' || skipperId.trim().length === 0) {
    throw new ApplicationError({
      category: 'INVALID_REQUEST',
      code: 'SKIPPER_ID_REQUIRED',
      message: 'A skipper id is required.'
    })
  }
}

/**
 * @param {Object} input
 * @param {import('mongodb').Db} input.db
 * @param {object} input.referenceDataClient Step 15 Reference Data Service client
 * @param {{ userId?: unknown } | null | undefined} input.authenticationContext
 * @param {string} input.vesselId
 * @param {string} [input.correlationId]
 * @returns {Promise<Readonly<{ vesselId: string, skippers: ReadonlyArray<object> }>>}
 */
export async function listSkippers({
  db,
  referenceDataClient,
  authenticationContext,
  vesselId,
  correlationId
}) {
  requireVesselId(vesselId)
  await enforceVesselProfileAccess({
    vesselId,
    referenceDataClient,
    authenticationContext,
    correlationId
  })

  const profile = await findVesselProfile(db, vesselId)

  return Object.freeze({
    vesselId: profile.vesselId,
    skippers: profile.skippers
  })
}

async function claimSkipperAddition({
  db,
  ownerUserId,
  vesselId,
  name,
  phoneNumber,
  email,
  idempotencyKey
}) {
  const fingerprint = computeRequestFingerprint({
    operationScope: IDEMPOTENCY_OPERATION_SCOPES.ADD_SKIPPER,
    idempotencyKey,
    allowedFields: ['vesselId', 'name', 'phoneNumber', 'email'],
    semanticInput: {
      vesselId,
      name,
      phoneNumber: phoneNumber ?? null,
      email: email ?? null
    }
  })

  const claim = await claimIdempotency(db, {
    ownerUserId,
    operationScope: IDEMPOTENCY_OPERATION_SCOPES.ADD_SKIPPER,
    idempotencyKey,
    resourceId: vesselId,
    fingerprint
  })

  if (claim.outcome === IDEMPOTENCY_CLAIM_OUTCOMES.IN_PROGRESS) {
    throw new ApplicationError({
      category: 'IDEMPOTENCY_CONFLICT',
      code: 'IDEMPOTENCY_REQUEST_IN_PROGRESS',
      message: 'An identical request is already being processed.'
    })
  }

  return { fingerprint, claim }
}

/**
 * @param {Object} input
 * @param {import('mongodb').Db} input.db
 * @param {object} input.referenceDataClient Step 15 Reference Data Service client
 * @param {{ userId?: unknown } | null | undefined} input.authenticationContext
 * @param {string} input.vesselId
 * @param {string} input.name
 * @param {string|null} [input.phoneNumber]
 * @param {string|null} [input.email]
 * @param {string} [input.idempotencyKey]
 * @param {string} [input.correlationId]
 * @returns {Promise<Readonly<{ vesselId: string, skippers: ReadonlyArray<object> }>>}
 */
export async function addSkipper({
  db,
  referenceDataClient,
  authenticationContext,
  vesselId,
  name,
  phoneNumber,
  email,
  idempotencyKey,
  correlationId
}) {
  requireVesselId(vesselId)
  requireSkipperName(name)
  await enforceVesselProfileAccess({
    vesselId,
    referenceDataClient,
    authenticationContext,
    correlationId
  })

  const ownerUserId = authenticationContext?.userId

  let idempotency
  if (idempotencyKey) {
    idempotency = await claimSkipperAddition({
      db,
      ownerUserId,
      vesselId,
      name,
      phoneNumber,
      email,
      idempotencyKey
    })
  }

  const profile = await persistAddSkipper(db, {
    vesselId,
    skipperId: randomUUID(),
    name,
    phoneNumber: phoneNumber ?? null,
    email: email ?? null,
    actorUserId: ownerUserId,
    now: trustedNowIso()
  })

  if (
    idempotencyKey &&
    idempotency.claim.outcome === IDEMPOTENCY_CLAIM_OUTCOMES.CLAIMED
  ) {
    await completeIdempotencyClaim(db, {
      ownerUserId,
      operationScope: IDEMPOTENCY_OPERATION_SCOPES.ADD_SKIPPER,
      idempotencyKey,
      resourceId: vesselId,
      fingerprint: idempotency.fingerprint,
      result: { vesselId },
      allowedResultFields: ['vesselId']
    })
  }

  return Object.freeze({
    vesselId: profile.vesselId,
    skippers: profile.skippers
  })
}

/**
 * @param {Object} input
 * @param {import('mongodb').Db} input.db
 * @param {object} input.referenceDataClient Step 15 Reference Data Service client
 * @param {{ userId?: unknown } | null | undefined} input.authenticationContext
 * @param {string} input.vesselId
 * @param {string} input.skipperId
 * @param {string} [input.correlationId]
 * @returns {Promise<void>}
 */
export async function removeSkipper({
  db,
  referenceDataClient,
  authenticationContext,
  vesselId,
  skipperId,
  correlationId
}) {
  requireVesselId(vesselId)
  requireSkipperId(skipperId)
  await enforceVesselProfileAccess({
    vesselId,
    referenceDataClient,
    authenticationContext,
    correlationId
  })

  await persistRemoveSkipper(db, {
    vesselId,
    skipperId,
    actorUserId: authenticationContext?.userId,
    now: trustedNowIso()
  })
}
