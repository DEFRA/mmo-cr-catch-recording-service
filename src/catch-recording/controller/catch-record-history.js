import { ApplicationError } from '#/common/helpers/errors/application-error.js'
import { deriveDisplayStatus } from '#/catch-recording/domain/display-status.js'
import { findCatchRecordByIdForOwner } from '#/catch-recording/persistence/catch-persistence.js'
import { listCatchHistoryEventsForOwner } from '#/catch-recording/persistence/catch-history-persistence.js'

/**
 * Step 31: the `CatchQuery` combined lifecycle-and-audit-history use case (`GET
 * /v1/catch-records/{catchRecordId}/history`).
 *
 * Framework-neutral: never imports Hapi, Boom, or the MongoDB driver — the only persistence access is
 * through `CatchPersistence`'s existing owner-scoped `findCatchRecordByIdForOwner` (current state) and
 * `listCatchHistoryEventsForOwner` (the Step 10 append-only history, already deterministically ordered
 * oldest-first). Read-only: never mutates the record or its history, never appends a further history
 * event for this read.
 */

/** The approved, minimal two-field metadata allow-list already enforced at the history-persistence
 * boundary (`catch-history-event.js`) - this module only decides *whether* to surface each field on a
 * given event item, never invents a third. */
const OPTIONAL_METADATA_FIELDS = Object.freeze(['section', 'submissionNumber'])

function catchRecordNotFoundError() {
  return new ApplicationError({
    category: 'RESOURCE_NOT_FOUND',
    code: 'CATCH_RECORD_NOT_FOUND',
    message: 'The requested catch record could not be found.'
  })
}

/**
 * Maps one stored, already-safe framework-neutral history event (from `listCatchHistoryEventsForOwner`)
 * to its public representation. The public `eventType` is the existing stable internal value, exposed
 * as-is (no translation table - mirrors the repository's existing convention of exposing persisted
 * lifecycle `status` directly). `section`/`submissionNumber` are included only when the stored event
 * actually carries that metadata field - never a placeholder `null`.
 *
 * @param {object} event
 * @returns {Readonly<object>}
 */
function buildPublicHistoryEvent(event) {
  const publicEvent = {
    id: event.id,
    eventType: event.eventType,
    timestamp: event.timestamp,
    actor: event.actorUserId
  }

  for (const field of OPTIONAL_METADATA_FIELDS) {
    if (event.metadata && Object.hasOwn(event.metadata, field)) {
      publicEvent[field] = event.metadata[field]
    }
  }

  return Object.freeze(publicEvent)
}

/**
 * @param {Object} input
 * @param {import('mongodb').Db} input.db
 * @param {{ userId: string, scopes: ReadonlyArray<string> }} input.authenticationContext
 * @param {string} input.catchRecordId
 * @param {number} input.limit the already Joi-validated, bounded event-page size
 * @returns {Promise<Readonly<object>>} the approved combined lifecycle-and-history response
 * @throws {ApplicationError} `RESOURCE_NOT_FOUND` when the record does not exist for this owner
 */
export async function getCatchRecordHistory({
  db,
  authenticationContext,
  catchRecordId,
  limit
}) {
  const ownerUserId = authenticationContext?.userId

  const catchRecord = await findCatchRecordByIdForOwner(db, {
    id: catchRecordId,
    ownerUserId
  })

  if (!catchRecord) {
    throw catchRecordNotFoundError()
  }

  const events = await listCatchHistoryEventsForOwner(db, {
    catchRecordId,
    ownerUserId,
    limit
  })

  return Object.freeze({
    catchRecordId: catchRecord.id,
    status: catchRecord.status,
    displayStatus: deriveDisplayStatus(catchRecord),
    version: catchRecord.version,
    hasUnsubmittedChanges: catchRecord.hasUnsubmittedChanges,
    numberOfSubmissions: catchRecord.numberOfSubmissions,
    events: Object.freeze(events.map(buildPublicHistoryEvent))
  })
}
