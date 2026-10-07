import {
  combineResults,
  createInvalidResult,
  createValidResult,
  formatPath
} from './validation-result.js'
import { validateCatchRecord } from './catch-record.js'
import { validateVessel } from './sections/vessel.js'
import { VALIDATION_CODES } from './validation-codes.js'
import { LIFECYCLE_CODES } from '../domain/lifecycle-codes.js'
import {
  canSubmitFirstTime,
  canResubmit
} from '../domain/lifecycle-transitions.js'
import { isGearComplete } from '../domain/gear-completeness.js'
import { resolveVessel } from '../reference-data/vessel-resolution.js'
import {
  resolvePort,
  resolveGear,
  resolveStatisticalArea,
  resolveSpecies
} from '../reference-data/reference-resolvers.js'

/**
 * Step 32: the one reusable complete-validation boundary. Composes, in order:
 *
 * 1. Step 07's reusable structural/section validation (`validateCatchRecord`).
 * 2. Vessel presence/shape (no separate section validator exists for `vessel` anywhere else).
 * 3. Lifecycle eligibility for a submission context (reusing Step 08's `canSubmitFirstTime`/
 *    `canResubmit` domain policy - never a third, competing lifecycle rule).
 * 4. Per-gear completeness (reusing Step 26's `isGearComplete` bar - a structurally valid but
 *    in-progress gear must never pass complete-validation).
 * 5. Submission-time reference-data revalidation (vessel, ports, gears, statistical areas, species) -
 *    the one asynchronous dimension, composed last and only once the record is structurally safe to
 *    walk.
 *
 * Framework-neutral except for its dependency on the already framework-neutral `reference-data` module
 * (no Hapi, Boom, Joi, or MongoDB import anywhere in this file or anything it imports). Never touches
 * persistence, never generates artifacts, never performs a lifecycle transition, never mutates its
 * input. Reusable identically by first submission and resubmission (Steps 34/38) - the same function,
 * the same result contract, regardless of caller.
 */

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasStableId(value) {
  return (
    isPlainObject(value) && typeof value.id === 'string' && value.id.length > 0
  )
}

/**
 * `true` only when the record is at least safe to walk for nested reference checks: a plain object
 * whose `gears` (when present) and `speciesNotLanded` (when present) are arrays. Mirrors
 * `validateCatchRecord`'s own "malformed root" short-circuit - this module never risks an unsafe nested
 * property access on a structurally malformed input.
 *
 * @param {unknown} catchRecord
 * @returns {boolean}
 */
function isSafeToWalk(catchRecord) {
  if (!isPlainObject(catchRecord)) {
    return false
  }

  const { gears, speciesNotLanded } = catchRecord
  return (
    (gears === undefined || Array.isArray(gears)) &&
    (speciesNotLanded === undefined || Array.isArray(speciesNotLanded))
  )
}

/**
 * Submission eligibility for complete-validation purposes: eligible when the record is either a
 * never-submitted draft (first submission) or an amended draft (resubmission). Reuses the existing
 * domain policy functions purely as boolean eligibility checks - their own detailed issue sets are not
 * threaded through, since exposing both would be confusing (every non-`DRAFT` status fails both checks
 * for overlapping reasons); one clear, deterministic issue is reported instead.
 *
 * @param {unknown} catchRecord
 * @returns {{ valid: boolean, issues: ReadonlyArray<object> }}
 */
function validateLifecycleEligibility(catchRecord) {
  if (canSubmitFirstTime(catchRecord).valid || canResubmit(catchRecord).valid) {
    return createValidResult()
  }

  return createInvalidResult({
    code: LIFECYCLE_CODES.INELIGIBLE_TRANSITION,
    path: formatPath(['status']),
    message:
      'Only a never-submitted draft or an amended draft is eligible for submission'
  })
}

/**
 * Per-gear completeness (Step 26's approved bar: at least one characteristic, exactly one
 * statistical area, at least one species caught, and at least one weight value per species) is a
 * mandatory dimension of submission readiness - an incomplete gear must never pass complete-validation,
 * even though it is perfectly valid for an in-progress section save (Step 20/21). Reuses
 * `isGearComplete` exactly rather than re-implementing the completeness bar a second time.
 *
 * @param {unknown} gears
 * @returns {{ valid: boolean, issues: ReadonlyArray<object> }}
 */
function validateGearsCompleteness(gears) {
  if (!Array.isArray(gears)) {
    // Already reported by `validateStructure`'s own container-shape check.
    return createValidResult()
  }

  if (gears.length === 0) {
    return createInvalidResult({
      code: VALIDATION_CODES.REQUIRED,
      path: formatPath(['gears']),
      message: 'At least one complete gear is required before submission'
    })
  }

  const issues = []
  gears.forEach((gear, index) => {
    if (!isGearComplete(gear)) {
      issues.push({
        code: VALIDATION_CODES.REQUIRED,
        path: formatPath(['gears', index]),
        message: 'This gear is not complete and cannot be submitted'
      })
    }
  })

  return issues.length === 0 ? createValidResult() : createInvalidResult(issues)
}

/**
 * Deduplicates reference-data calls for the same stable `(type, id)` pair within one validation
 * execution. The *promise* itself is cached (not its resolved value), so concurrently-issued requests
 * for the same reference never race into two separate upstream calls. Scoped to a single call to
 * `validateSubmissionReadiness` - never shared, never persisted, never a cross-request cache.
 *
 * @param {Map<string, Promise<unknown>>} cache
 * @param {string} key
 * @param {() => Promise<unknown>} resolve
 * @returns {Promise<unknown>}
 */
function resolveOnce(cache, key, resolve) {
  if (!cache.has(key)) {
    cache.set(key, resolve())
  }

  return cache.get(key)
}

async function validateVesselReference({
  vessel,
  referenceDataClient,
  authenticationContext,
  correlationId,
  cache
}) {
  if (!hasStableId(vessel)) {
    // Already reported by `validateVessel` - avoid a second, redundant reference-validity issue.
    return createValidResult()
  }

  const { result } = await resolveOnce(
    cache,
    `vessel:${vessel.id}`,
    async () => {
      const accessibleVesselIds =
        await referenceDataClient.listAccessibleVesselIds({
          correlationId
        })

      return resolveVessel({
        id: vessel.id,
        path: ['vessel'],
        client: referenceDataClient,
        authenticationContext,
        accessibleVesselIds,
        correlationId
      })
    }
  )

  return result
}

async function validatePortReference({
  port,
  path,
  referenceDataClient,
  correlationId,
  cache
}) {
  if (!hasStableId(port)) {
    return createValidResult()
  }

  const { result } = await resolveOnce(cache, `port:${port.id}`, () =>
    resolvePort({
      id: port.id,
      path,
      client: referenceDataClient,
      correlationId
    })
  )

  return result
}

async function validateGearReference({
  gear,
  path,
  referenceDataClient,
  correlationId,
  cache
}) {
  if (!hasStableId(gear)) {
    return createValidResult()
  }

  const { result } = await resolveOnce(cache, `gear:${gear.id}`, () =>
    resolveGear({
      id: gear.id,
      path,
      client: referenceDataClient,
      correlationId
    })
  )

  return result
}

async function validateStatisticalAreaReference({
  statisticalArea,
  path,
  referenceDataClient,
  correlationId,
  cache
}) {
  if (!hasStableId(statisticalArea)) {
    return createValidResult()
  }

  const { result } = await resolveOnce(
    cache,
    `statisticalArea:${statisticalArea.id}`,
    () =>
      resolveStatisticalArea({
        id: statisticalArea.id,
        path,
        client: referenceDataClient,
        correlationId
      })
  )

  return result
}

async function validateSpeciesReference({
  species,
  path,
  referenceDataClient,
  correlationId,
  cache
}) {
  if (!hasStableId(species)) {
    return createValidResult()
  }

  const { result } = await resolveOnce(cache, `species:${species.id}`, () =>
    resolveSpecies({
      id: species.id,
      path,
      client: referenceDataClient,
      correlationId
    })
  )

  return result
}

/**
 * Builds the full set of pending reference-revalidation checks for the already-safe-to-walk record.
 * Never re-validates a gear-characteristic relationship (the recorded Step 16 gap: neither the species
 * nor statistical-area schema carries a gear-reference field, so only existence/active-selection is
 * checked for every reference type here - never a relationship).
 *
 * @returns {Array<Promise<{ valid: boolean, issues: ReadonlyArray<object> }>>}
 */
function buildReferenceChecks(
  catchRecord,
  { referenceDataClient, authenticationContext, correlationId }
) {
  const cache = new Map()
  const checks = [
    validateVesselReference({
      vessel: catchRecord.vessel,
      referenceDataClient,
      authenticationContext,
      correlationId,
      cache
    })
  ]

  for (const field of ['departurePort', 'returnPort']) {
    checks.push(
      validatePortReference({
        port: catchRecord.trip?.[field],
        path: ['trip', field],
        referenceDataClient,
        correlationId,
        cache
      })
    )
  }

  const gears = Array.isArray(catchRecord.gears) ? catchRecord.gears : []
  gears.forEach((gearAssociation, gearIndex) => {
    checks.push(
      validateGearReference({
        gear: gearAssociation?.gear,
        path: ['gears', gearIndex, 'gear'],
        referenceDataClient,
        correlationId,
        cache
      }),
      validateStatisticalAreaReference({
        statisticalArea: gearAssociation?.statisticalArea,
        path: ['gears', gearIndex, 'statisticalArea'],
        referenceDataClient,
        correlationId,
        cache
      })
    )

    const speciesCaught = Array.isArray(gearAssociation?.speciesCaught)
      ? gearAssociation.speciesCaught
      : []
    speciesCaught.forEach((speciesEntry, speciesIndex) => {
      checks.push(
        validateSpeciesReference({
          species: speciesEntry,
          path: ['gears', gearIndex, 'speciesCaught', speciesIndex],
          referenceDataClient,
          correlationId,
          cache
        })
      )
    })
  })

  const speciesNotLanded = Array.isArray(catchRecord.speciesNotLanded)
    ? catchRecord.speciesNotLanded
    : []
  speciesNotLanded.forEach((speciesEntry, index) => {
    checks.push(
      validateSpeciesReference({
        species: speciesEntry,
        path: ['speciesNotLanded', index],
        referenceDataClient,
        correlationId,
        cache
      })
    )
  })

  return checks
}

/**
 * The Step 32 complete-validation entry point. Validates the authoritative persisted Catch Record
 * (never a client-provided replacement) and returns the one deterministic, immutable validation result.
 * Performs no persistence mutation, no artifact generation, and no lifecycle transition.
 *
 * Any reference-data *dependency* failure (timeout, unavailable, invalid upstream response) and any
 * vessel-access *authorisation* failure both propagate as a rejected promise (an `ApplicationError`),
 * exactly mirroring every other reference-resolution caller in this repository - they are never folded
 * into the returned validation-result `issues`, which are reserved for ordinary business-validation
 * outcomes only.
 *
 * @param {unknown} catchRecord the authoritative persisted canonical Catch Record
 * @param {Object} input
 * @param {object} input.referenceDataClient the Step 15 Reference Data Service client
 * @param {{ userId?: string, scopes?: ReadonlyArray<string> }} [input.authenticationContext]
 * @param {string} [input.correlationId]
 * @returns {Promise<{ valid: boolean, issues: ReadonlyArray<object> }>}
 */
export async function validateSubmissionReadiness(
  catchRecord,
  { referenceDataClient, authenticationContext, correlationId } = {}
) {
  const structuralAndSectionResult = validateCatchRecord(catchRecord)

  // Mirrors `validateCatchRecord`'s own "malformed root" short-circuit: a non-object root makes every
  // nested check (vessel presence, lifecycle fields, reference ids) meaningless to evaluate further.
  if (!isPlainObject(catchRecord)) {
    return structuralAndSectionResult
  }

  const syncResult = combineResults(
    structuralAndSectionResult,
    validateVessel(catchRecord.vessel),
    validateLifecycleEligibility(catchRecord),
    validateGearsCompleteness(catchRecord.gears)
  )

  if (!isSafeToWalk(catchRecord)) {
    return syncResult
  }

  const referenceResults = await Promise.all(
    buildReferenceChecks(catchRecord, {
      referenceDataClient,
      authenticationContext,
      correlationId
    })
  )

  return combineResults(syncResult, ...referenceResults)
}
