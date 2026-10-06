import { ApplicationError } from '#/common/helpers/errors/application-error.js'

/**
 * Step 17: friendly Catch Record reference generation.
 *
 * Owns the approved conceptual format `GBR-{RSS}-{DDMMYY}-{HHMMSS}`
 * (`design/architecture/catch-recording-service-design.md` §7.2), built from:
 * - Authoritative vessel RSS, approved-normalised (uppercased, whitespace and non-alphanumeric
 *   characters stripped).
 * - The approved business timezone (`businessTimezone` config, default `Europe/London`), applied with
 *   full DST awareness via `Intl.DateTimeFormat` - never the host machine or request timezone.
 * - Server-controlled time only - a caller-supplied `now` is accepted solely so later trusted
 *   application code and tests can inject a deterministic clock; a request body or header value must
 *   never reach this parameter.
 * - A collision-safe uniqueness strategy: on a collision, the candidate is regenerated against the next
 *   second-resolution server-controlled timestamp (never an appended suffix, so the approved format is
 *   never altered) and retried, bounded to `maxAttempts`.
 *
 * Framework-neutral: no Hapi, Boom, Joi, or MongoDB import. `referenceExists` is an injected,
 * already-trusted existence check (typically backed by `findCatchRecordByReference`) - this module never
 * queries a datastore itself.
 */

/** Bounded collision-retry ceiling (the Step 17 plan's "collision-safe uniqueness strategy" decision).
 * A generous technical ceiling, not a business value - a real collision this many times in a row would
 * indicate a systemic problem, not ordinary contention. */
export const MAX_REFERENCE_GENERATION_ATTEMPTS = 5

const COUNTRY_PREFIX = 'GBR'
const NON_ALPHANUMERIC_PATTERN = /[^A-Z0-9]/g

/**
 * Approved RSS normalisation: uppercase, then strip every whitespace and non-alphanumeric character.
 * Rejects anything that is not a non-empty string, and rejects a value that normalises to nothing (for
 * example a string of only punctuation/whitespace) - both are treated as a missing/malformed vessel RSS,
 * which must be rejected before any reference is generated or draft created (Step 17 plan).
 *
 * @param {unknown} rss
 * @returns {string} The normalised RSS.
 * @throws {ApplicationError} `BUSINESS_VALIDATION_FAILURE` when `rss` is missing or malformed.
 */
export function normaliseVesselRss(rss) {
  if (typeof rss !== 'string' || rss.trim().length === 0) {
    throw new ApplicationError({
      category: 'BUSINESS_VALIDATION_FAILURE',
      code: 'VESSEL_RSS_MISSING',
      message:
        'The selected vessel has no registration number available for reference generation.'
    })
  }

  const normalised = rss.toUpperCase().replace(NON_ALPHANUMERIC_PATTERN, '')

  if (normalised.length === 0) {
    throw new ApplicationError({
      category: 'BUSINESS_VALIDATION_FAILURE',
      code: 'VESSEL_RSS_MISSING',
      message:
        'The selected vessel has no registration number available for reference generation.'
    })
  }

  return normalised
}

/**
 * Formats a `Date` as the two approved business-timezone date/time components, fully DST-aware via
 * `Intl.DateTimeFormat` (never a fixed UTC offset).
 *
 * @param {Date} date
 * @param {string} timezone an IANA timezone identifier (`businessTimezone` config)
 * @returns {{ datePart: string, timePart: string }} `DDMMYY` and `HHMMSS`
 */
export function formatBusinessDateTime(date, timezone) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).formatToParts(date)

  const componentFor = (type) => parts.find((part) => part.type === type).value
  // Midnight renders as "24" under `hour12: false` in some ICU implementations; normalise to "00" to
  // keep the format a strict two-digit 24-hour clock.
  const hour = componentFor('hour') === '24' ? '00' : componentFor('hour')

  return {
    datePart: `${componentFor('day')}${componentFor('month')}${componentFor('year')}`,
    timePart: `${hour}${componentFor('minute')}${componentFor('second')}`
  }
}

function buildCandidate({ normalisedRss, timezone, candidateDate }) {
  const { datePart, timePart } = formatBusinessDateTime(candidateDate, timezone)
  return `${COUNTRY_PREFIX}-${normalisedRss}-${datePart}-${timePart}`
}

/**
 * Generates a unique friendly Catch Record reference.
 *
 * Deterministic under controlled test inputs: given the same `rss`, `timezone`, `now`, and
 * `referenceExists` behaviour, the same reference is always produced.
 *
 * @param {Object} input
 * @param {unknown} input.rss authoritative vessel RSS (approved-normalised here)
 * @param {string} input.timezone approved business timezone
 * @param {() => Date} [input.now] server-controlled clock; never a client-supplied value
 * @param {(candidate: string) => Promise<boolean>} input.referenceExists trusted existence check
 * @param {number} [input.maxAttempts]
 * @returns {Promise<string>} The unique generated reference.
 * @throws {ApplicationError} `BUSINESS_VALIDATION_FAILURE` (missing/malformed RSS) or
 *   `DUPLICATE_RESOURCE` (collision retries exhausted).
 */
export async function generateCatchRecordReference({
  rss,
  timezone,
  now = () => new Date(),
  referenceExists,
  maxAttempts = MAX_REFERENCE_GENERATION_ATTEMPTS
}) {
  const normalisedRss = normaliseVesselRss(rss)
  const baseTime = now().getTime()

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const candidate = buildCandidate({
      normalisedRss,
      timezone,
      candidateDate: new Date(baseTime + attempt * 1000)
    })

    const exists = await referenceExists(candidate)
    if (!exists) {
      return candidate
    }
  }

  throw new ApplicationError({
    category: 'DUPLICATE_RESOURCE',
    code: 'CATCH_RECORD_REFERENCE_GENERATION_FAILED',
    message:
      'A unique catch record reference could not be generated. Please try again.'
  })
}
