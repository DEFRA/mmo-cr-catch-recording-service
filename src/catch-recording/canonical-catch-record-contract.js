import Joi from 'joi'

import { CATCH_RECORD_STATUSES } from './canonical-catch-record-status.js'

// Canonical Catch Record Object v1 — structural contract (Step 05).
//
// This is the authoritative Catch Recording field vocabulary and hierarchy from
// design/design/catch-recording-service-design.md §9 "Canonical Data Model", expressed as a single Joi
// schema that permits legitimate incomplete drafts. Joi is used here purely as a standalone, framework-
// neutral structural-checking library: this module never imports Hapi or Boom, and the schema is never
// registered as a Hapi route `validate` key. Complete-record (submission-readiness) rules are explicitly
// deferred to Step 07 — this schema only enforces the canonical shape and vocabulary, not business
// completeness.
//
// A future v2 contract would be added as new exports in a sibling module (for example
// `canonical-catch-record-contract-v2.js`); nothing here would need to change.
export const CANONICAL_CATCH_RECORD_CONTRACT_VERSION = 'v1'

// Calendar dates use YYYY-MM-DD per design §5 ("Trip and port snapshots"). A plain string pattern is used
// rather than Joi.date() so no date parsing, timezone conversion or normalisation is performed here —
// that is explicitly out of scope for Step 05.
const calendarDateSchema = Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/)

// ISO 8601 UTC-compatible date-time string, also kept as a plain string: this module performs no
// date/time parsing or conversion.
const dateTimeSchema = Joi.string().isoDate()

const referenceSnapshotSchema = ({ idKey = 'id' } = {}) =>
  Joi.object({
    [idKey]: Joi.string(),
    codeSnapshot: Joi.string(),
    nameSnapshot: Joi.string()
  }).allow(null)

const vesselSchema = Joi.object({
  id: Joi.string(),
  nameSnapshot: Joi.string(),
  registrationSnapshot: Joi.string(),
  externalMarkSnapshot: Joi.string(),
  lengthOverallMetres: Joi.number().positive()
})
  .allow(null)
  .default(null)

const tripSchema = Joi.object({
  startedAndFinishedToday: Joi.boolean().allow(null),
  dateStarted: calendarDateSchema.allow(null),
  dateEnded: calendarDateSchema.allow(null),
  departurePort: referenceSnapshotSchema({ idKey: 'id' }),
  returnPort: referenceSnapshotSchema({ idKey: 'id' })
})
  .allow(null)
  .default(null)

const pairFishingSchema = Joi.object({
  enabled: Joi.boolean().allow(null),
  pairSkipperFullName: Joi.string().allow(null),
  pairVesselRssNumber: Joi.string().allow(null)
})
  .allow(null)
  .default(null)

const gearCharacteristicSchema = Joi.object({
  characteristicId: Joi.string(),
  nameSnapshot: Joi.string(),
  value: Joi.string()
})

const statisticalAreaSchema = Joi.object({
  id: Joi.string(),
  code: Joi.string(),
  nameSnapshot: Joi.string()
})
  .allow(null)
  .default(null)

const speciesAttributeSchema = Joi.object({
  attributeId: Joi.string(),
  nameSnapshot: Joi.string(),
  value: Joi.string()
})

const speciesCaughtSchema = Joi.object({
  speciesId: Joi.string(),
  faoCodeSnapshot: Joi.string(),
  nameSnapshot: Joi.string(),
  attributes: Joi.array().items(speciesAttributeSchema).default([])
})

const gearSchema = Joi.object({
  gearId: Joi.string(),
  associationId: Joi.string(),
  codeSnapshot: Joi.string(),
  nameSnapshot: Joi.string(),
  characteristics: Joi.array().items(gearCharacteristicSchema).default([]),
  statisticalArea: statisticalAreaSchema,
  speciesCaught: Joi.array().items(speciesCaughtSchema).default([])
})

// retainedCatch.species intentionally has no per-entry item shape: the approved design
// (design/design/catch-recording-service-design.md §9.1) defines only an opaque `retainedCatch: {}`
// placeholder, and the per-species-entry field contract is assigned to Phase 8 (Steps 37-40). Per the
// user's explicit decision (resolved via Clarification Resolver escalation during Step 05 planning),
// `species` is deferred as an untyped, empty-permitted array in Canonical Catch Record Object v1.
const retainedCatchSchema = Joi.object({
  answer: Joi.string().valid('YES', 'NO').allow(null),
  species: Joi.array().default([])
})
  .allow(null)
  .default(null)

const auditEditEventSchema = Joi.object({
  dateEdited: dateTimeSchema,
  fishermanId: Joi.string(),
  previousStatus: Joi.string().valid(...CATCH_RECORD_STATUSES),
  reason: Joi.string().allow(null)
})

const auditSchema = Joi.object({
  editEvents: Joi.array().items(auditEditEventSchema).default([])
})
  .allow(null)
  .default({ editEvents: [] })

const artifactSchema = Joi.object({
  submissionNumber: Joi.number().integer().positive(),
  jsonSnapshotS3Key: Joi.string(),
  pdfReceiptS3Key: Joi.string(),
  submittedAt: dateTimeSchema.allow(null),
  submittedBy: Joi.string().allow(null)
})

export const catchRecordSchemaV1 = Joi.object({
  // Identity and ownership (server-owned).
  id: Joi.string().allow(null).default(null),
  catchRecordReference: Joi.string().allow(null).default(null),
  ownerUserId: Joi.string().allow(null).default(null),

  // Lifecycle and version metadata (server-owned).
  status: Joi.string()
    .valid(...CATCH_RECORD_STATUSES)
    .default('DRAFT'),
  version: Joi.number().integer().positive().default(1),
  numberOfSubmissions: Joi.number().integer().min(0).default(0),
  hasUnsubmittedChanges: Joi.boolean().default(false),

  // Client-supplied/selectable business sections.
  vessel: vesselSchema,
  trip: tripSchema,
  pairFishing: pairFishingSchema,
  gear: Joi.array().items(gearSchema).default([]),
  retainedCatch: retainedCatchSchema,

  // Server-owned audit and artifact metadata.
  audit: auditSchema,
  artifacts: Joi.array().items(artifactSchema).default([]),

  // Creation, update, submission and completion metadata (server-owned).
  createdAt: dateTimeSchema.allow(null).default(null),
  createdBy: Joi.string().allow(null).default(null),
  updatedAt: dateTimeSchema.allow(null).default(null),
  updatedBy: Joi.string().allow(null).default(null),
  submittedAt: dateTimeSchema.allow(null).default(null),
  submittedBy: Joi.string().allow(null).default(null),
  completedAt: dateTimeSchema.allow(null).default(null),
  completedBy: Joi.string().allow(null).default(null)
})

// Returns Joi's own minimal `{ value, error }` result shape rather than a bespoke validation-result
// catalogue — Step 07 owns building any richer, business-facing validation-result catalogue on top of
// this. `abortEarly: false` collects every structural failure in one pass. The supplied `candidate` is
// never mutated; Joi always returns a newly constructed `value`.
export function validateCatchRecordStructureV1(candidate) {
  return catchRecordSchemaV1.validate(candidate, {
    abortEarly: false,
    convert: false
  })
}
