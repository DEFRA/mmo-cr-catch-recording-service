import { ApplicationError } from '#/common/helpers/errors/application-error.js'
import { deriveDisplayStatus } from '#/catch-recording/domain/display-status.js'
import {
  canSubmitFirstTime,
  canResubmit
} from '#/catch-recording/domain/lifecycle-transitions.js'
import { findCatchRecordByIdForOwner } from '#/catch-recording/persistence/catch-persistence.js'
import {
  buildSectionCompletion,
  buildProgress
} from './standard-save-response.js'

/**
 * Step 29: the `CatchQuery` complete Catch Record retrieval use case (`GET
 * /v1/catch-records/{catchRecordId}`).
 *
 * Framework-neutral: never imports Hapi, Boom, or the MongoDB driver — the only persistence access is
 * through `CatchPersistence`'s existing owner-scoped `findCatchRecordByIdForOwner` primitive. Read-only:
 * never mutates the record, never increments the version, never appends a history event, never calls the
 * Reference Data Service merely to refresh a stored display snapshot.
 */

function catchRecordNotFoundError() {
  return new ApplicationError({
    category: 'RESOURCE_NOT_FOUND',
    code: 'CATCH_RECORD_NOT_FOUND',
    message: 'The requested catch record could not be found.'
  })
}

/**
 * The approved completed/incomplete section-name lists, derived from the same `buildSectionCompletion`
 * facts reused from Step 22/26 — never a second, competing completeness calculation.
 *
 * @param {Readonly<{ trip: boolean, pairFishing: boolean, gears: boolean }>} sectionCompletion
 * @returns {{ completedSections: ReadonlyArray<string>, incompleteSections: ReadonlyArray<string> }}
 */
function splitSectionsByCompletion(sectionCompletion) {
  const completedSections = []
  const incompleteSections = []

  for (const [section, isComplete] of Object.entries(sectionCompletion)) {
    ;(isComplete ? completedSections : incompleteSections).push(section)
  }

  return {
    completedSections: Object.freeze(completedSections),
    incompleteSections: Object.freeze(incompleteSections)
  }
}

/**
 * The Step 29 preliminary submission-eligibility fact: `true` only when the lifecycle currently permits a
 * submission (a never-submitted `DRAFT`, or an amended `DRAFT`) **and** every section is complete.
 * Deliberately does not re-validate reference-data currency or landing/retained-catch consistency — that
 * is Step 32's final submission-readiness capability, not yet implemented; this never claims eligibility
 * for an incomplete or lifecycle-ineligible record, but a `true` result here is not itself proof that
 * Step 32 will accept a submission.
 *
 * @param {object} catchRecord
 * @param {Readonly<{ trip: boolean, pairFishing: boolean, gears: boolean }>} sectionCompletion
 * @returns {boolean}
 */
function deriveSubmissionEligible(catchRecord, sectionCompletion) {
  const lifecycleEligible =
    canSubmitFirstTime(catchRecord).valid || canResubmit(catchRecord).valid

  const allSectionsComplete =
    sectionCompletion.trip &&
    sectionCompletion.pairFishing &&
    sectionCompletion.gears

  return Boolean(lifecycleEligible && allSectionsComplete)
}

/**
 * @param {Object} input
 * @param {import('mongodb').Db} input.db
 * @param {{ userId: string, scopes: ReadonlyArray<string> }} input.authenticationContext
 * @param {string} input.catchRecordId
 * @returns {Promise<Readonly<object>>} the complete canonical Catch Record plus derived progress facts
 * @throws {ApplicationError} `RESOURCE_NOT_FOUND` when the record does not exist for this owner
 */
export async function retrieveCatchRecord({
  db,
  authenticationContext,
  catchRecordId
}) {
  const ownerUserId = authenticationContext?.userId

  const catchRecord = await findCatchRecordByIdForOwner(db, {
    id: catchRecordId,
    ownerUserId
  })

  if (!catchRecord) {
    throw catchRecordNotFoundError()
  }

  const sectionCompletion = buildSectionCompletion(catchRecord)
  const { completedSections, incompleteSections } =
    splitSectionsByCompletion(sectionCompletion)

  return Object.freeze({
    ...catchRecord,
    displayStatus: deriveDisplayStatus(catchRecord),
    sectionCompletion,
    completedSections,
    incompleteSections,
    progress: buildProgress(catchRecord),
    submissionEligible: deriveSubmissionEligible(catchRecord, sectionCompletion)
  })
}
