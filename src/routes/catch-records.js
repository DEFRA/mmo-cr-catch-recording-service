import Joi from 'joi'
import { getTraceId } from '@defra/hapi-tracing'

import { config } from '#/config.js'
import { createDraftCatchRecord } from '#/catch-recording/controller/create-draft-catch-record.js'
import { abandonDraftCatchRecord } from '#/catch-recording/controller/abandon-draft-catch-record.js'
import {
  saveCatchRecordSection,
  SECTION_ALLOW_LIST
} from '#/catch-recording/controller/save-catch-record-section.js'
import { listCatchRecords } from '#/catch-recording/controller/list-catch-records.js'
import { retrieveCatchRecord } from '#/catch-recording/controller/retrieve-catch-record.js'
import { replaceCatchRecord } from '#/catch-recording/controller/replace-catch-record.js'
import { getCatchRecordHistory } from '#/catch-recording/controller/catch-record-history.js'
import { MAX_IDEMPOTENCY_KEY_LENGTH } from '#/catch-recording/persistence/idempotency-key.js'
import { PERSISTED_STATUSES } from '#/catch-recording/domain/lifecycle-status.js'

const AUTH_STRATEGY = 'authentication-service'

const HTTP_STATUS_OK = 200
const HTTP_STATUS_CREATED = 201
const HTTP_STATUS_NO_CONTENT = 204

/** The single-resource Catch Record path, shared by every `GET`/`PUT`/`DELETE`/`PATCH` route that
 * addresses one Catch Record by ID - defined once to avoid duplicating the literal across routes. */
const CATCH_RECORD_PATH = '/v1/catch-records/{catchRecordId}'

/** Step 30 approved mobile complete-replacement payload ceiling (user-confirmed, no earlier approved
 * value existed): 1 MB. */
const MAX_COMPLETE_REPLACEMENT_PAYLOAD_BYTES = 1_048_576

/** Step 28/31 approved bounded-list-page-size contract (user-confirmed, no earlier approved value
 * existed) - deliberately shared by both bounded-list endpoints in this phase (listing and history). */
const DEFAULT_LIST_LIMIT = 20
const MAX_LIST_QUERY_LIMIT = 100

const listCatchRecordsQuerySchema = Joi.object({
  limit: Joi.number()
    .integer()
    .min(1)
    .max(MAX_LIST_QUERY_LIMIT)
    .default(DEFAULT_LIST_LIMIT),
  status: Joi.string().valid(...Object.values(PERSISTED_STATUSES))
})

async function listCatchRecordsHandler(request, h) {
  const response = await listCatchRecords({
    db: request.db,
    authenticationContext: request.auth.credentials,
    limit: request.query.limit,
    status: request.query.status
  })

  return h.response(response).code(HTTP_STATUS_OK)
}

const createDraftHeadersSchema = Joi.object({
  'idempotency-key': Joi.string()
    .trim()
    .min(1)
    .max(MAX_IDEMPOTENCY_KEY_LENGTH)
    .optional()
}).unknown(true)

const createDraftPayloadSchema = Joi.object({
  vesselId: Joi.string().trim().min(1).required()
}).required()

async function createDraftCatchRecordHandler(request, h) {
  const response = await createDraftCatchRecord({
    db: request.db,
    referenceDataClient: request.referenceDataClient,
    authenticationContext: request.auth.credentials,
    vesselId: request.payload?.vesselId,
    idempotencyKey: request.headers['idempotency-key'],
    businessTimezone: config.get('businessTimezone'),
    correlationId: getTraceId()
  })

  return h.response(response).code(HTTP_STATUS_CREATED)
}

const catchRecordIdParamsSchema = Joi.object({
  catchRecordId: Joi.string().trim().min(1).required()
})

async function retrieveCatchRecordHandler(request, h) {
  const response = await retrieveCatchRecord({
    db: request.db,
    authenticationContext: request.auth.credentials,
    catchRecordId: request.params.catchRecordId
  })

  return h.response(response).code(HTTP_STATUS_OK)
}

const catchRecordHistoryQuerySchema = Joi.object({
  limit: Joi.number()
    .integer()
    .min(1)
    .max(MAX_LIST_QUERY_LIMIT)
    .default(DEFAULT_LIST_LIMIT)
})

async function getCatchRecordHistoryHandler(request, h) {
  const response = await getCatchRecordHistory({
    db: request.db,
    authenticationContext: request.auth.credentials,
    catchRecordId: request.params.catchRecordId,
    limit: request.query.limit
  })

  return h.response(response).code(HTTP_STATUS_OK)
}

const expectedVersionHeadersSchema = Joi.object({
  'if-match': Joi.string()
    .trim()
    .pattern(/^[1-9]\d*$/)
    .required()
}).unknown(true)

// Step 30: Joi validates only the HTTP/transport shape of each client-owned section (object vs. array,
// no unknown root property) - the approved reusable business validation (`validateCatchRecord`) and
// complete-object normalisation (`normaliseCatchRecord`) own every structural/business rule below that.
// The outer schema's default unknown-key rejection is the first of three independent server-owned-field
// defences (see `replace-catch-record.js`'s module docstring).
const completeReplacementPayloadSchema = Joi.object({
  vessel: Joi.object().unknown(true).required(),
  trip: Joi.object().unknown(true).required(),
  pairFishing: Joi.object().unknown(true).required(),
  gears: Joi.array().items(Joi.object().unknown(true)).required(),
  speciesNotLanded: Joi.array().items(Joi.object().unknown(true)).required()
}).required()

async function replaceCatchRecordHandler(request, h) {
  const response = await replaceCatchRecord({
    db: request.db,
    referenceDataClient: request.referenceDataClient,
    authenticationContext: request.auth.credentials,
    catchRecordId: request.params.catchRecordId,
    expectedVersion: Number(request.headers['if-match']),
    payload: request.payload,
    businessTimezone: config.get('businessTimezone'),
    correlationId: getTraceId()
  })

  return h.response(response).code(HTTP_STATUS_OK)
}

async function abandonDraftCatchRecordHandler(request, h) {
  await abandonDraftCatchRecord({
    db: request.db,
    authenticationContext: request.auth.credentials,
    catchRecordId: request.params.catchRecordId,
    expectedVersion: Number(request.headers['if-match'])
  })

  return h.response().code(HTTP_STATUS_NO_CONTENT)
}

// `gears` and `speciesNotLanded` are collection-valued sections (Step 23 / Step 27 redesign): their
// `data` is an ordered array, while every other approved section's `data` is a single nested object. The
// conditional keeps both transport shapes validated explicitly - a malformed `data` shape for the given
// `section` is rejected here with a safe 400, before the handler/normaliser ever sees it.
const ARRAY_VALUED_SECTIONS = ['gears', 'speciesNotLanded']

const sectionPatchPayloadSchema = Joi.object({
  section: Joi.string()
    .valid(...SECTION_ALLOW_LIST)
    .required(),
  data: Joi.when('section', {
    is: Joi.valid(...ARRAY_VALUED_SECTIONS),
    then: Joi.array().items(Joi.object().unknown(true)).required(),
    otherwise: Joi.object().unknown(true).required()
  })
}).required()

async function saveCatchRecordSectionHandler(request, h) {
  const response = await saveCatchRecordSection({
    db: request.db,
    referenceDataClient: request.referenceDataClient,
    authenticationContext: request.auth.credentials,
    catchRecordId: request.params.catchRecordId,
    expectedVersion: Number(request.headers['if-match']),
    section: request.payload.section,
    data: request.payload.data,
    businessTimezone: config.get('businessTimezone'),
    correlationId: getTraceId()
  })

  return h.response(response).code(HTTP_STATUS_OK)
}

/**
 * Step 17/18/19/20/21/28: `GET`/`POST`/`DELETE`/`PATCH /v1/catch-records[/{catchRecordId}]`.
 *
 * Thin handlers only: Joi validates the transport shape, every route requires the trusted
 * `authentication-service` strategy, and all business orchestration lives in the dedicated controller
 * modules under `src/catch-recording/controller/`.
 */
export const catchRecords = [
  {
    method: 'GET',
    path: '/v1/catch-records',
    options: {
      auth: AUTH_STRATEGY,
      validate: {
        query: listCatchRecordsQuerySchema
      }
    },
    handler: listCatchRecordsHandler
  },
  {
    method: 'POST',
    path: '/v1/catch-records',
    options: {
      auth: AUTH_STRATEGY,
      validate: {
        headers: createDraftHeadersSchema,
        payload: createDraftPayloadSchema
      }
    },
    handler: createDraftCatchRecordHandler
  },
  {
    method: 'GET',
    path: CATCH_RECORD_PATH,
    options: {
      auth: AUTH_STRATEGY,
      validate: {
        params: catchRecordIdParamsSchema
      }
    },
    handler: retrieveCatchRecordHandler
  },
  {
    method: 'PUT',
    path: CATCH_RECORD_PATH,
    options: {
      auth: AUTH_STRATEGY,
      payload: { maxBytes: MAX_COMPLETE_REPLACEMENT_PAYLOAD_BYTES },
      validate: {
        params: catchRecordIdParamsSchema,
        headers: expectedVersionHeadersSchema,
        payload: completeReplacementPayloadSchema
      }
    },
    handler: replaceCatchRecordHandler
  },
  {
    method: 'GET',
    path: `${CATCH_RECORD_PATH}/history`,
    options: {
      auth: AUTH_STRATEGY,
      validate: {
        params: catchRecordIdParamsSchema,
        query: catchRecordHistoryQuerySchema
      }
    },
    handler: getCatchRecordHistoryHandler
  },
  {
    method: 'DELETE',
    path: CATCH_RECORD_PATH,
    options: {
      auth: AUTH_STRATEGY,
      validate: {
        params: catchRecordIdParamsSchema,
        headers: expectedVersionHeadersSchema
      }
    },
    handler: abandonDraftCatchRecordHandler
  },
  {
    method: 'PATCH',
    path: CATCH_RECORD_PATH,
    options: {
      auth: AUTH_STRATEGY,
      validate: {
        params: catchRecordIdParamsSchema,
        headers: expectedVersionHeadersSchema,
        payload: sectionPatchPayloadSchema
      }
    },
    handler: saveCatchRecordSectionHandler
  }
]
