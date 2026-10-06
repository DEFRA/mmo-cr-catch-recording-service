import { deriveDisplayStatus } from '#/catch-recording/domain/display-status.js'
import { evaluateGearsProgress } from '#/catch-recording/domain/gear-completeness.js'
import { listCatchRecordsByOwner } from '#/catch-recording/persistence/catch-persistence.js'

/**
 * Step 28: the `CatchQuery` owner-scoped Catch Record listing use case (`GET /v1/catch-records`).
 *
 * Framework-neutral: never imports Hapi, Boom, or the MongoDB driver — the only persistence access is
 * through `CatchPersistence`'s existing owner-scoped `listCatchRecordsByOwner` primitive. Reuses the
 * existing Step 08 display-status policy and Step 26 domain-progress capability rather than duplicating
 * either; never recalculates persistence, never calls the Reference Data Service, never mutates a
 * record, and never creates a history event for a read.
 *
 * @param {object} catchRecord a persisted canonical record returned by `listCatchRecordsByOwner`
 * @returns {Readonly<object>} the approved minimal dashboard summary
 */
function buildListingSummary(catchRecord) {
  return Object.freeze({
    id: catchRecord.id,
    catchRecordReference: catchRecord.catchRecordReference,
    status: catchRecord.status,
    displayStatus: deriveDisplayStatus(catchRecord),
    version: catchRecord.version,
    vessel: Object.freeze({
      nameSnapshot: catchRecord.vessel?.nameSnapshot,
      rssSnapshot: catchRecord.vessel?.rssSnapshot
    }),
    trip: Object.freeze({
      dateStarted: catchRecord.trip?.dateStarted ?? null,
      dateEnded: catchRecord.trip?.dateEnded ?? null
    }),
    createdAt: catchRecord.createdAt,
    updatedAt: catchRecord.updatedAt,
    submittedAt: catchRecord.submittedAt,
    completedAt: catchRecord.completedAt,
    progress: Object.freeze({
      allGearsComplete: evaluateGearsProgress(catchRecord.gears)
        .allGearsComplete
    })
  })
}

/**
 * @param {Object} input
 * @param {import('mongodb').Db} input.db
 * @param {{ userId: string, scopes: ReadonlyArray<string> }} input.authenticationContext
 * @param {number} input.limit the already Joi-validated, bounded page size
 * @param {string} [input.status] the already Joi-validated, optional persisted-status filter
 * @returns {Promise<Readonly<{ items: ReadonlyArray<object>, limit: number, count: number }>>} the
 *   approved listing envelope
 */
export async function listCatchRecords({
  db,
  authenticationContext,
  limit,
  status
}) {
  const ownerUserId = authenticationContext?.userId

  const catchRecords = await listCatchRecordsByOwner(db, {
    ownerUserId,
    limit,
    status
  })

  const items = catchRecords.map(buildListingSummary)

  return Object.freeze({
    items: Object.freeze(items),
    limit,
    count: items.length
  })
}
