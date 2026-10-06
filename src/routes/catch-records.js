import Joi from 'joi'
import { getTraceId } from '@defra/hapi-tracing'

import { config } from '#/config.js'
import { createDraftCatchRecord } from '#/catch-recording/controller/create-draft-catch-record.js'
import { abandonDraftCatchRecord } from '#/catch-recording/controller/abandon-draft-catch-record.js'
import {
  saveCatchRecordSection,
  SECTION_ALLOW_LIST
} from '#/catch-recording/controller/save-catch-record-section.js'
import { MAX_IDEMPOTENCY_KEY_LENGTH } from '#/catch-recording/persistence/idempotency-key.js'

const AUTH_STRATEGY = 'authentication-service'

const HTTP_STATUS_OK = 200
const HTTP_STATUS_CREATED = 201
const HTTP_STATUS_NO_CONTENT = 204

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

const expectedVersionHeadersSchema = Joi.object({
  'if-match': Joi.string()
    .trim()
    .pattern(/^[1-9]\d*$/)
    .required()
}).unknown(true)

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
 * Step 17/18/19/20/21: `POST`/`DELETE`/`PATCH /v1/catch-records[/{catchRecordId}]`.
 *
 * Thin handlers only: Joi validates the transport shape, every route requires the trusted
 * `authentication-service` strategy, and all business orchestration lives in the dedicated controller
 * modules under `src/catch-recording/controller/`.
 */
export const catchRecords = [
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
    method: 'DELETE',
    path: '/v1/catch-records/{catchRecordId}',
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
    path: '/v1/catch-records/{catchRecordId}',
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
