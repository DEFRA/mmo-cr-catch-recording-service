import Joi from 'joi'
import { getTraceId } from '@defra/hapi-tracing'

import {
  listFavouriteGears,
  addFavouriteGear,
  removeFavouriteGear,
  listFavouriteSpecies,
  addFavouriteSpecies,
  removeFavouriteSpecies,
  listFavouritePorts,
  addFavouritePort,
  removeFavouritePort
} from '#/catch-recording/controller/vessel-favourites.js'
import {
  listSkippers,
  addSkipper,
  removeSkipper
} from '#/catch-recording/controller/vessel-skippers.js'
import { MAX_IDEMPOTENCY_KEY_LENGTH } from '#/catch-recording/persistence/idempotency-key.js'

const AUTH_STRATEGY = 'authentication-service'

const HTTP_STATUS_OK = 200
const HTTP_STATUS_NO_CONTENT = 204

/** Server-side bounds for skipper input fields (`docs/configuration-decisions.md` "Phase 9 decisions")
 * — no approved business value exists anywhere in the approved plans for a skipper field length; these
 * exist only so a caller defect or a hostile caller can never produce an unbounded stored value,
 * mirroring `MAX_IDEMPOTENCY_KEY_LENGTH`'s own justification. */
const MAX_SKIPPER_NAME_LENGTH = 100
const MAX_SKIPPER_PHONE_LENGTH = 30
const MAX_SKIPPER_EMAIL_LENGTH = 254

const vesselIdParamsSchema = Joi.object({
  vesselId: Joi.string().trim().min(1).required()
})

const idempotencyHeadersSchema = Joi.object({
  'idempotency-key': Joi.string()
    .trim()
    .min(1)
    .max(MAX_IDEMPOTENCY_KEY_LENGTH)
    .optional()
}).unknown(true)

function favouriteIdParamsSchema(idField) {
  return vesselIdParamsSchema.keys({
    [idField]: Joi.string().trim().min(1).required()
  })
}

function favouritePayloadSchema(idField) {
  return Joi.object({
    [idField]: Joi.string().trim().min(1).required()
  }).required()
}

const skipperPayloadSchema = Joi.object({
  name: Joi.string().trim().min(1).max(MAX_SKIPPER_NAME_LENGTH).required(),
  phoneNumber: Joi.string()
    .trim()
    .min(1)
    .max(MAX_SKIPPER_PHONE_LENGTH)
    .optional(),
  email: Joi.string().trim().email().max(MAX_SKIPPER_EMAIL_LENGTH).optional()
}).required()

const skipperIdParamsSchema = vesselIdParamsSchema.keys({
  skipperId: Joi.string().trim().min(1).required()
})

function buildListHandler(listOperation) {
  return async function listHandler(request, h) {
    const response = await listOperation({
      db: request.db,
      referenceDataClient: request.referenceDataClient,
      authenticationContext: request.auth.credentials,
      vesselId: request.params.vesselId,
      correlationId: getTraceId()
    })

    return h.response(response).code(HTTP_STATUS_OK)
  }
}

function buildAddFavouriteHandler(addOperation, idField) {
  return async function addFavouriteHandler(request, h) {
    const response = await addOperation({
      db: request.db,
      referenceDataClient: request.referenceDataClient,
      authenticationContext: request.auth.credentials,
      vesselId: request.params.vesselId,
      [idField]: request.payload[idField],
      idempotencyKey: request.headers['idempotency-key'],
      correlationId: getTraceId()
    })

    return h.response(response).code(HTTP_STATUS_OK)
  }
}

function buildRemoveFavouriteHandler(removeOperation, idField) {
  return async function removeFavouriteHandler(request, h) {
    await removeOperation({
      db: request.db,
      referenceDataClient: request.referenceDataClient,
      authenticationContext: request.auth.credentials,
      vesselId: request.params.vesselId,
      [idField]: request.params[idField],
      correlationId: getTraceId()
    })

    return h.response().code(HTTP_STATUS_NO_CONTENT)
  }
}

async function addSkipperHandler(request, h) {
  const response = await addSkipper({
    db: request.db,
    referenceDataClient: request.referenceDataClient,
    authenticationContext: request.auth.credentials,
    vesselId: request.params.vesselId,
    name: request.payload.name,
    phoneNumber: request.payload.phoneNumber,
    email: request.payload.email,
    idempotencyKey: request.headers['idempotency-key'],
    correlationId: getTraceId()
  })

  return h.response(response).code(HTTP_STATUS_OK)
}

async function removeSkipperHandler(request, h) {
  await removeSkipper({
    db: request.db,
    referenceDataClient: request.referenceDataClient,
    authenticationContext: request.auth.credentials,
    vesselId: request.params.vesselId,
    skipperId: request.params.skipperId,
    correlationId: getTraceId()
  })

  return h.response().code(HTTP_STATUS_NO_CONTENT)
}

/** One closed, explicit entry per approved favourite type — not a dynamically-keyed loop — mirroring
 * `vessel-favourites.js`'s own per-type configuration objects. */
const FAVOURITE_ROUTES = [
  {
    path: 'favourite-gears',
    idField: 'gearId',
    list: listFavouriteGears,
    add: addFavouriteGear,
    remove: removeFavouriteGear
  },
  {
    path: 'favourite-species',
    idField: 'speciesId',
    list: listFavouriteSpecies,
    add: addFavouriteSpecies,
    remove: removeFavouriteSpecies
  },
  {
    path: 'favourite-ports',
    idField: 'portId',
    list: listFavouritePorts,
    add: addFavouritePort,
    remove: removeFavouritePort
  }
]

function buildFavouriteRoutes({ path, idField, list, add, remove }) {
  const collectionPath = `/v1/vessels/{vesselId}/${path}`
  const itemPath = `${collectionPath}/{${idField}}`

  return [
    {
      method: 'GET',
      path: collectionPath,
      options: {
        auth: AUTH_STRATEGY,
        validate: { params: vesselIdParamsSchema }
      },
      handler: buildListHandler(list)
    },
    {
      method: 'POST',
      path: collectionPath,
      options: {
        auth: AUTH_STRATEGY,
        validate: {
          params: vesselIdParamsSchema,
          headers: idempotencyHeadersSchema,
          payload: favouritePayloadSchema(idField)
        }
      },
      handler: buildAddFavouriteHandler(add, idField)
    },
    {
      method: 'DELETE',
      path: itemPath,
      options: {
        auth: AUTH_STRATEGY,
        validate: { params: favouriteIdParamsSchema(idField) }
      },
      handler: buildRemoveFavouriteHandler(remove, idField)
    }
  ]
}

/**
 * Step 39: vessel-scoped favourites and vessel-owned skippers (`GET`/`POST`/`DELETE
 * /v1/vessels/{vesselId}/favourite-{gears|species|ports}[/{id}]`, `GET`/`POST`/`DELETE
 * /v1/vessels/{vesselId}/skippers[/{skipperId}]`).
 *
 * Thin handlers only: Joi validates the transport shape, every route requires the trusted
 * `authentication-service` strategy, and all business orchestration lives in
 * `src/catch-recording/controller/vessel-favourites.js` and `vessel-skippers.js`.
 */
export const vesselProfiles = [
  ...FAVOURITE_ROUTES.flatMap((config) => buildFavouriteRoutes(config)),
  {
    method: 'GET',
    path: '/v1/vessels/{vesselId}/skippers',
    options: {
      auth: AUTH_STRATEGY,
      validate: { params: vesselIdParamsSchema }
    },
    handler: buildListHandler(listSkippers)
  },
  {
    method: 'POST',
    path: '/v1/vessels/{vesselId}/skippers',
    options: {
      auth: AUTH_STRATEGY,
      validate: {
        params: vesselIdParamsSchema,
        headers: idempotencyHeadersSchema,
        payload: skipperPayloadSchema
      }
    },
    handler: addSkipperHandler
  },
  {
    method: 'DELETE',
    path: '/v1/vessels/{vesselId}/skippers/{skipperId}',
    options: {
      auth: AUTH_STRATEGY,
      validate: { params: skipperIdParamsSchema }
    },
    handler: removeSkipperHandler
  }
]
