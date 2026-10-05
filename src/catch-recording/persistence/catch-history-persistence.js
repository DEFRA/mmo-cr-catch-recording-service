import {
  getCatchHistoryCollection,
  ensureCatchHistoryIndexes,
  CATCH_HISTORY_COLLECTION
} from './catch-history-collection.js'
import { toHistoryDocument, toHistoryEvent } from './catch-history-mapper.js'
import {
  validateHistoryEventInput,
  CATCH_HISTORY_EVENT_TYPES
} from './catch-history-event.js'
import { assertPlainString, assertSafeListLimit } from './persistence-guards.js'
import {
  malformedHistoryDocumentError,
  unexpectedHistoryPersistenceError
} from './catch-history-errors.js'

/**
 * The Catch Record history capability of `CatchPersistence` — one simple, append-only Catch Record
 * history mechanism.
 *
 * Public API is deliberately minimal: `appendCatchHistoryEvent` (insert only) and
 * `listCatchHistoryEventsForOwner` (owner-safe, bounded, deterministically ordered read). No update,
 * replace, upsert, or delete capability is exposed anywhere in this module — see
 * `architecture-boundary.test.js`'s exported-name check.
 *
 * Does not implement: event sourcing, a generic audit framework, public HTTP endpoints, the business
 * decision to emit an event, lifecycle/section-save/submission orchestration, optimistic concurrency, or
 * idempotency (Steps 11-12 and beyond). See `docs/catch-recording-persistence.md` for the full contract.
 */

/** Persistence-owned technical safety ceiling for `listCatchHistoryEventsForOwner` (see the Step 10
 * plan's "Owner-safe query operation" decision). Not a business page size — no approved default/page-size
 * value exists yet. Callers must always supply an explicit `limit`. */
export const MAX_HISTORY_LIST_LIMIT = 100

function mapStoredDocument(document) {
  try {
    return toHistoryEvent(document)
  } catch (cause) {
    throw malformedHistoryDocumentError(cause)
  }
}

/**
 * Appends exactly one Catch Record history event. Insert-only — never updates, replaces, or deletes an
 * existing event. Accepts an input already supplied by a later trusted application operation (the
 * business decision to emit the event, and the trusted timestamp/actor it carries, are not made here).
 * Does not mutate `input`.
 *
 * @param {import('mongodb').Db} db
 * @param {{
 *   catchRecordId: string,
 *   ownerUserId: string,
 *   eventType: string,
 *   timestamp: string,
 *   actorUserId: string,
 *   metadata?: object
 * }} input
 * @returns {Promise<object>} An independent framework-neutral copy of the appended event, including its
 *   server-generated `id`.
 */
export async function appendCatchHistoryEvent(db, input) {
  const event = validateHistoryEventInput(input)
  const collection = getCatchHistoryCollection(db)
  const document = toHistoryDocument(event)

  let insertedId
  try {
    const result = await collection.insertOne(document)
    insertedId = result.insertedId
  } catch (error) {
    throw unexpectedHistoryPersistenceError(error)
  }

  return mapStoredDocument({ ...document, _id: insertedId })
}

/**
 * Owner-safe, bounded, deterministically ordered retrieval of a Catch Record's history. Ownership is
 * part of the MongoDB filter itself — never a post-query comparison, never resolved via a cross-
 * collection join (mirroring `findCatchRecordByIdForOwner`'s established pattern). An unknown
 * `catchRecordId`, a mismatched owner, or a Catch Record with no history all return the same empty
 * array — no distinguishing behaviour, no disclosure.
 *
 * Ordered ascending by trusted `timestamp`, tie-broken by ascending `_id` (a stable, deterministic
 * insertion-order proxy for events sharing an identical timestamp).
 *
 * @param {import('mongodb').Db} db
 * @param {{ catchRecordId: string, ownerUserId: string, limit: number }} params
 * @returns {Promise<Array<object>>} Independent framework-neutral history events.
 */
export async function listCatchHistoryEventsForOwner(
  db,
  { catchRecordId, ownerUserId, limit }
) {
  assertPlainString(catchRecordId, 'catchRecordId')
  assertPlainString(ownerUserId, 'ownerUserId')
  assertSafeListLimit(limit, MAX_HISTORY_LIST_LIMIT)

  const collection = getCatchHistoryCollection(db)

  let documents
  try {
    documents = await collection
      .find({ catchRecordId, ownerUserId })
      .sort({ timestamp: 1, _id: 1 })
      .limit(limit)
      .toArray()
  } catch (error) {
    throw unexpectedHistoryPersistenceError(error)
  }

  return documents.map((document) => mapStoredDocument(document))
}

export {
  ensureCatchHistoryIndexes,
  CATCH_HISTORY_COLLECTION,
  CATCH_HISTORY_EVENT_TYPES
}
