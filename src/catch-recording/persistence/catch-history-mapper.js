import { isSupportedHistoryEventType } from './catch-history-event.js'

/**
 * Explicit mapping between the framework-neutral history-event contract and its MongoDB document
 * representation. Mirrors `catch-record-mapper.js`'s pattern: every field assigned by name, never a
 * spread of either side, nested structures (`metadata`) deep-cloned so neither mapping shares a mutable
 * reference with its input.
 */

const SCALAR_FIELDS = Object.freeze([
  'catchRecordId',
  'ownerUserId',
  'eventType',
  'timestamp',
  'actorUserId'
])

function cloneMetadata(metadata) {
  return metadata === undefined ? undefined : structuredClone(metadata)
}

/**
 * Maps a validated framework-neutral history-event input to its MongoDB document representation.
 * Does not set `_id` — MongoDB generates it on `insertOne`.
 *
 * @param {object} event A `validateHistoryEventInput`-validated event.
 * @returns {object} The MongoDB document to insert.
 */
export function toHistoryDocument(event) {
  const document = {}

  for (const field of SCALAR_FIELDS) {
    document[field] = event[field]
  }

  const metadata = cloneMetadata(event.metadata)
  if (metadata !== undefined) {
    document.metadata = metadata
  }

  return document
}

function assertNonEmptyString(value, fieldName) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(
      `Stored history event document has an invalid "${fieldName}" field`
    )
  }
}

/**
 * Maps a stored MongoDB history document back to a framework-neutral history event.
 *
 * Returns only the approved fields — the MongoDB `_id` is converted to the framework-neutral `id`
 * (a hex string, never a raw `ObjectId` instance) and any unknown stored field is excluded, never
 * silently becoming an output field. Fails safely (throws `TypeError`, caught and translated by the
 * caller into a safe `ApplicationError`) for a non-object document, a missing/invalid `_id`,
 * `catchRecordId`, `ownerUserId`, `actorUserId`, `timestamp`, or an unsupported `eventType`.
 *
 * @param {object} document
 * @returns {object} The framework-neutral history event.
 */
export function toHistoryEvent(document) {
  if (document === null || typeof document !== 'object') {
    throw new TypeError('Stored history event document is not an object')
  }

  if (document._id === undefined || document._id === null) {
    throw new TypeError(
      'Stored history event document has an invalid "id" field'
    )
  }

  assertNonEmptyString(document.catchRecordId, 'catchRecordId')
  assertNonEmptyString(document.ownerUserId, 'ownerUserId')
  assertNonEmptyString(document.timestamp, 'timestamp')
  assertNonEmptyString(document.actorUserId, 'actorUserId')

  if (!isSupportedHistoryEventType(document.eventType)) {
    throw new TypeError(
      'Stored history event document has an invalid "eventType" field'
    )
  }

  const event = {
    id:
      typeof document._id === 'string'
        ? document._id
        : document._id.toHexString()
  }

  for (const field of SCALAR_FIELDS) {
    event[field] = document[field]
  }

  const metadata = cloneMetadata(document.metadata)
  if (metadata !== undefined) {
    event.metadata = metadata
  }

  return event
}
