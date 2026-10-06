import { ApplicationError } from '#/common/helpers/errors/application-error.js'
import {
  resolveGear,
  resolveGearCharacteristic,
  resolveStatisticalArea
} from '#/catch-recording/reference-data/reference-resolvers.js'
import { resolveSpeciesCaught } from './resolve-species-caught.js'

/**
 * Step 23's save-time snapshot-resolution boundary for the `gears` section, extended by Step 24
 * (`statisticalArea`) and Step 25 (`speciesCaught`/catch details). Resolves each incoming gear selection,
 * its supplied characteristics, its optional statistical area, and its optional species-caught
 * collection fresh from the Reference Data Service, exactly mirroring the `resolveTripPorts` precedent —
 * **never** trusting a client-supplied snapshot. Any client-supplied snapshot field
 * (`gear.codeSnapshot`/`nameSnapshot`, a characteristic's `unitSnapshot`/`nameSnapshot`, a statistical
 * area's `codeSnapshot`/`nameSnapshot`, a species' `faoCodeSnapshot`/`nameSnapshot`, a catch detail's
 * `unitSnapshot`/`nameSnapshot`) is discarded and replaced by the freshly resolved value; only the stable
 * `id`/`characteristicId`/`attributeId` and (for a characteristic or catch detail) the supplied `value`
 * ever survive into the output.
 *
 * `statisticalArea` and `speciesCaught` are both genuinely optional (Step 24/25): when either key is
 * **absent** from an incoming gear association, the output entry has no such key at all, which the
 * reconciliation (`reconcile-gears.js`) reads as "leave this gear's current value unchanged". For
 * `statisticalArea`, an explicit `null` clears it; for `speciesCaught`, the key being present (even as an
 * empty or `null` array) means "this is the authoritative full species list for this gear".
 *
 * A gear/characteristic/statistical-area/species/catch-detail-attribute that cannot be resolved (missing
 * id, malformed id, not found, or inactive) contributes its issue(s) to a single aggregated list; if any
 * issue was collected across the whole collection, one
 * `BUSINESS_VALIDATION_FAILURE`/`SECTION_VALIDATION_FAILED` `ApplicationError` is thrown with
 * `details: issues`. Any other Reference Data Service dependency failure (timeout, unavailable, malformed
 * upstream response) propagates unchanged — it is never folded into a validation outcome.
 *
 * Never mutates `normalisedGears` or any of its nested objects.
 *
 * @param {unknown} normalisedGears the already-normalised `gears` collection (validated structurally by
 *   `validateGears` before this is called — a non-array value is treated defensively as an empty
 *   collection so this module never crashes when exercised in isolation)
 * @param {object} referenceDataClient Step 15 Reference Data Service client (`getGearById`, ...)
 * @param {string} [correlationId]
 * @returns {Promise<Array<{ associationId?: string, gear: object, characteristics: Array<object>,
 *   statisticalArea?: object|null, speciesCaught?: Array<object> }>>} ordered exactly as supplied
 * @throws {ApplicationError} `BUSINESS_VALIDATION_FAILURE` when any gear/characteristic/statistical
 *   area/species/catch-detail-attribute cannot be resolved; any Reference Data Service dependency failure
 *   is rethrown unchanged
 */
export async function resolveGearsSection(
  normalisedGears,
  referenceDataClient,
  correlationId
) {
  const gearAssociations = Array.isArray(normalisedGears) ? normalisedGears : []
  const issues = []
  const resolvedIncomingGears = []

  for (const [index, gearAssociation] of gearAssociations.entries()) {
    const resolvedEntry = await resolveOneGearAssociation({
      gearAssociation,
      index,
      referenceDataClient,
      correlationId,
      issues
    })

    if (resolvedEntry) {
      resolvedIncomingGears.push(resolvedEntry)
    }
  }

  if (issues.length > 0) {
    throw sectionValidationError(issues)
  }

  return resolvedIncomingGears
}

async function resolveOneGearAssociation({
  gearAssociation,
  index,
  referenceDataClient,
  correlationId,
  issues
}) {
  const {
    result: gearResult,
    snapshot: gearSnapshot,
    resolved: resolvedGear
  } = await resolveGear({
    id: gearAssociation?.gear?.id,
    path: ['gears', index, 'gear'],
    client: referenceDataClient,
    correlationId
  })

  if (!gearResult.valid) {
    issues.push(...gearResult.issues)
    return null
  }

  const characteristics = resolveCharacteristics({
    gearAssociation,
    index,
    resolvedGear,
    issues
  })

  const resolvedEntry = {
    gear: { id: gearAssociation.gear.id, ...gearSnapshot },
    characteristics
  }

  if (
    typeof gearAssociation.associationId === 'string' &&
    gearAssociation.associationId.length > 0
  ) {
    resolvedEntry.associationId = gearAssociation.associationId
  }

  await resolveStatisticalAreaField({
    gearAssociation,
    index,
    referenceDataClient,
    correlationId,
    issues,
    resolvedEntry
  })

  await resolveSpeciesCaughtField({
    gearAssociation,
    index,
    referenceDataClient,
    correlationId,
    issues,
    resolvedEntry
  })

  return resolvedEntry
}

/**
 * Step 24: resolves an optional, nullable per-gear `statisticalArea` selection and assigns it onto
 * `resolvedEntry` only when the incoming association actually owns the key — mirroring the "absent vs
 * explicit null" distinction `copyField`/`normaliseReferenceSelection` already preserve through
 * normalisation, so reconciliation can tell "leave unchanged" (key absent) apart from "clear the area"
 * (key `null`) apart from "set the area" (key present with a resolved snapshot).
 */
async function resolveStatisticalAreaField({
  gearAssociation,
  index,
  referenceDataClient,
  correlationId,
  issues,
  resolvedEntry
}) {
  if (!Object.hasOwn(gearAssociation, 'statisticalArea')) {
    return
  }

  if (gearAssociation.statisticalArea === null) {
    resolvedEntry.statisticalArea = null
    return
  }

  const { result, snapshot } = await resolveStatisticalArea({
    id: gearAssociation.statisticalArea?.id,
    path: ['gears', index, 'statisticalArea'],
    client: referenceDataClient,
    correlationId
  })

  if (!result.valid) {
    issues.push(...result.issues)
    return
  }

  resolvedEntry.statisticalArea = {
    id: gearAssociation.statisticalArea.id,
    ...snapshot
  }
}

/**
 * Step 25: resolves an optional per-gear `speciesCaught` collection and assigns it onto `resolvedEntry`
 * only when the incoming association actually owns the key — mirroring the Step 24 `statisticalArea`
 * absent/present distinction, so reconciliation (`reconcile-gears.js`) can tell "leave this gear's
 * current species collection unchanged" (key absent) apart from "this is the authoritative full species
 * list for this gear" (key present, even as an empty array). An explicit `null` is treated the same as
 * an empty array (clearing every species from this gear) rather than left unhandled, since no approved
 * contract gives `speciesCaught: null` any other meaning.
 */
async function resolveSpeciesCaughtField({
  gearAssociation,
  index,
  referenceDataClient,
  correlationId,
  issues,
  resolvedEntry
}) {
  if (!Object.hasOwn(gearAssociation, 'speciesCaught')) {
    return
  }

  resolvedEntry.speciesCaught = await resolveSpeciesCaught({
    speciesCaught: gearAssociation.speciesCaught,
    gearIndex: index,
    referenceDataClient,
    correlationId,
    issues
  })
}

function resolveCharacteristics({
  gearAssociation,
  index,
  resolvedGear,
  issues
}) {
  const sourceCharacteristics = Array.isArray(gearAssociation.characteristics)
    ? gearAssociation.characteristics
    : []

  const characteristics = []

  sourceCharacteristics.forEach((characteristic, characteristicIndex) => {
    const { result: characteristicResult, snapshot: characteristicSnapshot } =
      resolveGearCharacteristic({
        characteristicId: characteristic?.characteristicId,
        path: ['gears', index, 'characteristics', characteristicIndex],
        gear: resolvedGear
      })

    if (!characteristicResult.valid) {
      issues.push(...characteristicResult.issues)
      return
    }

    characteristics.push({
      characteristicId: characteristic.characteristicId,
      value: characteristic.value,
      ...characteristicSnapshot
    })
  })

  return characteristics
}

function sectionValidationError(issues) {
  return new ApplicationError({
    category: 'BUSINESS_VALIDATION_FAILURE',
    code: 'SECTION_VALIDATION_FAILED',
    message: 'The supplied section data is invalid.',
    details: issues
  })
}
