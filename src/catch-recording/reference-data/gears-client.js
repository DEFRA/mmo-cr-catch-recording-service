import { isValidStableId } from './stable-id.js'
import {
  invalidReferenceRequestError,
  referenceItemNotFoundError,
  upstreamInvalidResponseError
} from './reference-data-errors.js'
import {
  isNonEmptyString,
  isNullableString,
  isNullableFiniteNumber,
  isStringArray,
  isPlainObject,
  isOptionalField
} from './response-validators.js'
import { isSuccessStatus } from './http-status.js'

const BASE_PATH = '/api/v1/reference-data/gears'

// Declarative field validators: reduces both the single-expression conditional-operator count and each
// function's cyclomatic complexity compared with one large `&&` chain, without changing behaviour.
//
// Step 43: the canonical (default) collection view's top-level `characteristics[]` catalog stopped
// reliably resolving a gear's `applicableCharacteristics[].characteristicId` to a name/unit (confirmed
// empirically against the live Reference Data Service - a canonical `ids=`-filtered request returns the
// gear item alone, with no `characteristics[]` catalog beside it, contradicting the documented contract).
// `getGearById` now requests `view=mobile` instead, whose `GearMobileItem`/`measurements[]` shape is used
// exclusively - there is no fallback to the canonical shape. Per confirmed product decision, gear
// active-selection is no longer checked (the mobile view carries no `active` field at all) - see
// `active-selection.js`'s `isGearSelectable`.
const GEAR_MOBILE_ITEM_VALIDATORS = Object.freeze([
  ['id', isNonEmptyString],
  ['code', isNonEmptyString],
  ['name', isNonEmptyString],
  ['pairFishing', (value) => typeof value === 'boolean'],
  ['requiredMeasurementIds', isStringArray],
  ['variableMeasurementIds', isStringArray]
])

const MEASUREMENT_VALIDATORS = Object.freeze([
  ['id', isNonEmptyString],
  ['code', isNonEmptyString],
  ['label', isNonEmptyString],
  ['kind', isNonEmptyString],
  ['unit', (value) => isOptionalField(value, isNullableString)],
  ['minimumValue', (value) => isOptionalField(value, isNullableFiniteNumber)],
  ['maximumValue', (value) => isOptionalField(value, isNullableFiniteNumber)]
])

function matchesAllFields(entry, validators) {
  return validators.every(([field, validator]) => validator(entry[field]))
}

function isValidGearMobileItem(entry) {
  // `category` is deliberately never validated or exposed - it is required by the upstream schema but,
  // exactly like the canonical view's `categories[]` before it, has no consumer anywhere in this
  // service (gear snapshots use only the gear's own code/name, never its category).
  return (
    isPlainObject(entry) && matchesAllFields(entry, GEAR_MOBILE_ITEM_VALIDATORS)
  )
}

function isValidMeasurement(entry) {
  return isPlainObject(entry) && matchesAllFields(entry, MEASUREMENT_VALIDATORS)
}

/**
 * Joins one mobile gear item's `requiredMeasurementIds`/`variableMeasurementIds` with the collection
 * envelope's top-level `measurements[]` catalog, producing one resolved, self-contained
 * `characteristics[]` array. A measurement id referenced by the item but absent from the catalog, or an
 * id present in both id lists (an inconsistent required/variable classification), is treated as
 * inconsistent upstream data (`UPSTREAM_INVALID_RESPONSE`), never silently dropped or repaired.
 *
 * @param {{ requiredMeasurementIds: string[], variableMeasurementIds: string[] }} gearItem
 * @param {Map<string, object>} measurementsById
 * @returns {object[] | null}
 */
function resolveCharacteristics(gearItem, measurementsById) {
  const requiredIds = new Set(gearItem.requiredMeasurementIds)
  const variableIds = new Set(gearItem.variableMeasurementIds)

  const hasInconsistentClassification = gearItem.requiredMeasurementIds.some(
    (id) => variableIds.has(id)
  )
  if (hasInconsistentClassification) {
    return null
  }

  const resolved = []
  for (const measurementId of [
    ...gearItem.requiredMeasurementIds,
    ...gearItem.variableMeasurementIds
  ]) {
    const definition = measurementsById.get(measurementId)
    if (!definition) {
      return null
    }

    resolved.push(
      Object.freeze({
        characteristicId: measurementId,
        required: requiredIds.has(measurementId),
        name: definition.label,
        unit: definition.unit ?? null,
        dataType: definition.kind,
        minValue: definition.minimumValue ?? null,
        maxValue: definition.maximumValue ?? null
      })
    )
  }

  return resolved
}

/**
 * Validates the full mobile-view collection envelope returned by the `ids`-filtered gear collection
 * request, then resolves exactly the one matching gear's characteristics against the top-level
 * `measurements[]` catalog.
 *
 * @param {unknown} body
 * @returns {object | null} the resolved gear, or `null` for a malformed envelope
 */
function validateAndResolveGearResponse(body) {
  if (!isPlainObject(body)) {
    return null
  }

  const { items, measurements } = body

  if (
    !Array.isArray(items) ||
    !items.every((item) => isValidGearMobileItem(item)) ||
    !Array.isArray(measurements) ||
    !measurements.every((entry) => isValidMeasurement(entry))
  ) {
    return null
  }

  if (items.length !== 1) {
    // 0 matches is handled by the caller as not-found; >1 matches for a single-ID filter is malformed.
    return items.length === 0 ? { notFound: true } : null
  }

  const [gearItem] = items
  const measurementsById = new Map(
    measurements.map((entry) => [entry.id, entry])
  )
  const resolvedCharacteristics = resolveCharacteristics(
    gearItem,
    measurementsById
  )
  if (!resolvedCharacteristics) {
    return null
  }

  return Object.freeze({
    id: gearItem.id,
    code: gearItem.code,
    name: gearItem.name,
    pairFishing: gearItem.pairFishing,
    characteristics: Object.freeze(resolvedCharacteristics)
  })
}

/**
 * @param {{ httpClient: { get: Function } }} deps
 * @returns {(id: string, options?: { correlationId?: string }) => Promise<object>}
 */
export function createGetGearById({ httpClient }) {
  return async function getGearById(id, { correlationId } = {}) {
    if (!isValidStableId(id)) {
      throw invalidReferenceRequestError('A valid gear id is required.')
    }

    const query = `ids=${encodeURIComponent(id)}&includeInactive=true&view=mobile`
    const { status, body } = await httpClient.get({
      path: `${BASE_PATH}?${query}`,
      correlationId
    })

    if (!isSuccessStatus(status)) {
      throw upstreamInvalidResponseError(
        new Error(`Unexpected gear response status ${status}`)
      )
    }

    const result = validateAndResolveGearResponse(body)
    if (!result) {
      throw upstreamInvalidResponseError(
        new Error('Malformed gear response body')
      )
    }

    if (result.notFound) {
      throw referenceItemNotFoundError('gear')
    }

    return result
  }
}
