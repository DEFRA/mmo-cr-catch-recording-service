import { assertPlainString } from './persistence-guards.js'

/**
 * The framework-neutral Catch Record history-event contract.
 *
 * Owns: the stable event-type catalogue, the trusted-timestamp/actor shape, and the safe bounded
 * metadata allow-list. Has no MongoDB, Hapi, or Boom awareness — `catch-history-mapper.js` is the only
 * place this contract is translated to/from a MongoDB document.
 *
 * Does not decide when a business event occurs, does not implement event handlers/dispatch, and does
 * not implement any later-phase producer (draft creation, section save, submission, etc.) — those are
 * later steps. This module only defines and validates the shape those future callers must supply.
 */

/**
 * The eight approved stable event types (`design/plans/catch-recording-service-detailed-implementation-
 * plan.md` §6 "History and audit approach"). No other value is ever accepted as `eventType`.
 */
export const CATCH_HISTORY_EVENT_TYPES = Object.freeze({
  DRAFT_CREATED: 'DRAFT_CREATED',
  SECTION_SAVED: 'SECTION_SAVED',
  DRAFT_ABANDONED: 'DRAFT_ABANDONED',
  SUBMITTED: 'SUBMITTED',
  COMPLETED: 'COMPLETED',
  EDIT_STARTED: 'EDIT_STARTED',
  AMENDMENT_SECTION_SAVED: 'AMENDMENT_SECTION_SAVED',
  RESUBMITTED: 'RESUBMITTED'
})

const EVENT_TYPE_VALUES = Object.freeze(
  Object.values(CATCH_HISTORY_EVENT_TYPES)
)

/**
 * The Step 05 canonical nested-section names (`NESTED_FIELDS` in `catch-record-mapper.js`) — the only
 * values the metadata `section` field may carry. A label naming which canonical section an event
 * relates to; never the section's content.
 */
const ALLOWED_METADATA_SECTIONS = Object.freeze([
  'vessel',
  'trip',
  'pairFishing',
  'gears',
  'landing',
  'artifacts'
])

/** A generous but explicit bound — no approved document requires a submission count anywhere near this
 * high; this exists only so a future caller defect can never produce an unsafe/unbounded value. */
const MAX_SUBMISSION_NUMBER = 1000

const DISALLOWED_METADATA_KEYS = Object.freeze([
  '__proto__',
  'constructor',
  'prototype'
])

/** The exact, smallest metadata allow-list approved by repository evidence (see the Step 10 saved plan,
 * "Metadata allow-list" decision). Each field is tied to an already-approved canonical concept — no
 * speculative future-event metadata is added. */
const ALLOWED_METADATA_FIELDS = Object.freeze(['section', 'submissionNumber'])

const TRUSTED_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/

/**
 * @param {unknown} value
 * @returns {boolean}
 */
export function isSupportedHistoryEventType(value) {
  return typeof value === 'string' && EVENT_TYPE_VALUES.includes(value)
}

function assertSupportedEventType(eventType) {
  if (!isSupportedHistoryEventType(eventType)) {
    throw new TypeError(
      '"eventType" must be one of the approved history event types'
    )
  }
}

function assertTrustedTimestamp(timestamp) {
  assertPlainString(timestamp, 'timestamp')

  if (
    !TRUSTED_TIMESTAMP_PATTERN.test(timestamp) ||
    Number.isNaN(Date.parse(timestamp))
  ) {
    throw new TypeError(
      '"timestamp" must be a valid ISO-8601 UTC ("Z"-suffixed) string'
    )
  }
}

function assertSafeSection(value) {
  if (!ALLOWED_METADATA_SECTIONS.includes(value)) {
    throw new TypeError(
      '"metadata.section" must be one of the approved canonical section names'
    )
  }
}

function assertSafeSubmissionNumber(value) {
  if (!Number.isInteger(value) || value <= 0 || value > MAX_SUBMISSION_NUMBER) {
    throw new TypeError(
      `"metadata.submissionNumber" must be an integer between 1 and ${MAX_SUBMISSION_NUMBER}`
    )
  }
}

/**
 * Rejects any metadata shape outside the approved two-field allow-list. Structurally prevents complete
 * Catch Record copies, artifact bodies, credentials, tokens, raw dependency responses, nested arbitrary
 * structures, and prototype pollution — not by convention, by construction: no allowed field can hold
 * any of those shapes.
 *
 * Returns an independent, safe metadata object (or `undefined` when no metadata was supplied).
 *
 * @param {unknown} metadata
 * @returns {object|undefined}
 */
export function assertSafeHistoryMetadata(metadata) {
  if (metadata === undefined) {
    return undefined
  }

  if (
    metadata === null ||
    typeof metadata !== 'object' ||
    Array.isArray(metadata)
  ) {
    throw new TypeError('"metadata" must be a plain object when supplied')
  }

  const keys = Object.keys(metadata)
  const safeMetadata = {}

  for (const key of keys) {
    if (
      DISALLOWED_METADATA_KEYS.includes(key) ||
      !ALLOWED_METADATA_FIELDS.includes(key)
    ) {
      throw new TypeError(`"metadata.${key}" is not an approved metadata field`)
    }

    if (key === 'section') {
      assertSafeSection(metadata.section)
      safeMetadata.section = metadata.section
    }

    if (key === 'submissionNumber') {
      assertSafeSubmissionNumber(metadata.submissionNumber)
      safeMetadata.submissionNumber = metadata.submissionNumber
    }
  }

  return safeMetadata
}

/**
 * Validates and constructs one framework-neutral history-event input. Never mutates `input`; always
 * returns an independent, frozen object built from explicitly copied fields.
 *
 * @param {{
 *   catchRecordId: string,
 *   ownerUserId: string,
 *   eventType: string,
 *   timestamp: string,
 *   actorUserId: string,
 *   metadata?: object
 * }} input
 * @returns {Readonly<object>}
 */
export function validateHistoryEventInput(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('History event input must be a plain object')
  }

  assertPlainString(input.catchRecordId, 'catchRecordId')
  assertPlainString(input.ownerUserId, 'ownerUserId')
  assertSupportedEventType(input.eventType)
  assertTrustedTimestamp(input.timestamp)
  assertPlainString(input.actorUserId, 'actorUserId')

  const metadata = assertSafeHistoryMetadata(input.metadata)

  return Object.freeze({
    catchRecordId: input.catchRecordId,
    ownerUserId: input.ownerUserId,
    eventType: input.eventType,
    timestamp: input.timestamp,
    actorUserId: input.actorUserId,
    ...(metadata !== undefined ? { metadata: Object.freeze(metadata) } : {})
  })
}
