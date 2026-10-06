import { VALIDATION_CODES } from '../validation-codes.js'
import {
  createInvalidResult,
  createValidResult,
  formatPath,
  combineResults
} from '../validation-result.js'

function issue(code, pathSegments, message) {
  return { code, path: formatPath(pathSegments), message }
}

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function isIsoDate(value) {
  return isNonEmptyString(value) && ISO_DATE_PATTERN.test(value)
}

function validatePort(port, pathSegments) {
  if (
    port === undefined ||
    port === null ||
    typeof port !== 'object' ||
    Array.isArray(port)
  ) {
    return createInvalidResult(
      issue(
        VALIDATION_CODES.REQUIRED,
        pathSegments,
        'A port selection is required'
      )
    )
  }

  if (!isNonEmptyString(port.id)) {
    return createInvalidResult(
      issue(
        VALIDATION_CODES.REQUIRED,
        [...pathSegments, 'id'],
        'A port id is required'
      )
    )
  }

  return createValidResult()
}

/**
 * Validates the trip-date decision and its dependent dates.
 *
 * `startedAndFinishedToday: true` resolves `dateStarted`/`dateEnded` from the trusted business date
 * server-side (Step 17's business-timezone infrastructure) - whatever a client supplies for either date
 * in that case is discarded and recomputed, never validated or trusted, so this validator only confirms
 * they are well-formed ISO dates *when present* (the always-populated stored canonical form). This
 * validator only enforces presence/format for the `false` ("manual dates") branch, where the client's
 * supplied dates are the ones actually persisted. Whether a manual date is in the future relative to the
 * trusted business date is a time-dependent check outside this pure, clockless validator's scope - the
 * calling application operation enforces it using the same trusted business-date source.
 *
 * @param {unknown} trip
 * @returns {{ valid: boolean, issues: ReadonlyArray<object> }}
 */
function validateTripDates(trip) {
  if (typeof trip.startedAndFinishedToday !== 'boolean') {
    return createInvalidResult(
      issue(
        VALIDATION_CODES.REQUIRED,
        ['trip', 'startedAndFinishedToday'],
        'A trip-date decision is required'
      )
    )
  }

  if (trip.startedAndFinishedToday === true) {
    const issues = []
    for (const field of ['dateStarted', 'dateEnded']) {
      if (
        trip[field] !== null &&
        trip[field] !== undefined &&
        !isIsoDate(trip[field])
      ) {
        issues.push(
          issue(
            VALIDATION_CODES.INVALID_STRUCTURE,
            ['trip', field],
            'Must be a valid ISO date when present'
          )
        )
      }
    }
    return issues.length === 0
      ? createValidResult()
      : createInvalidResult(issues)
  }

  const issues = []
  if (!isIsoDate(trip.dateStarted)) {
    issues.push(
      issue(VALIDATION_CODES.REQUIRED, ['trip', 'dateStarted'], 'Required')
    )
  }
  if (!isIsoDate(trip.dateEnded)) {
    issues.push(
      issue(VALIDATION_CODES.REQUIRED, ['trip', 'dateEnded'], 'Required')
    )
  }
  if (issues.length === 0 && trip.dateEnded < trip.dateStarted) {
    issues.push(
      issue(
        VALIDATION_CODES.CONDITIONAL_FIELD_INCONSISTENT,
        ['trip', 'dateEnded'],
        'Must not be before dateStarted'
      )
    )
  }

  return issues.length === 0 ? createValidResult() : createInvalidResult(issues)
}

/**
 * Validates the complete trip section: the trip-date decision and its dependent dates, plus the
 * departure and return port selections. Reusable both for a standalone Step 20/21 section PATCH and for
 * the Step 32 complete-record validator.
 *
 * @param {unknown} trip
 * @returns {{ valid: boolean, issues: ReadonlyArray<object> }}
 */
export function validateTrip(trip) {
  if (typeof trip !== 'object' || trip === null || Array.isArray(trip)) {
    return createValidResult()
  }

  return combineResults(
    validateTripDates(trip),
    validatePort(trip.departurePort, ['trip', 'departurePort']),
    validatePort(trip.returnPort, ['trip', 'returnPort'])
  )
}
