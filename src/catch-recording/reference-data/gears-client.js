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
  isPlainObject
} from './response-validators.js'

const BASE_PATH = '/api/v1/reference-data/gears'

function isValidApplicableCharacteristic(entry) {
  if (!isPlainObject(entry)) {
    return false
  }

  const { id, characteristicId, fixed, required, vesselLengthApplicability } =
    entry

  return (
    isNonEmptyString(id) &&
    isNonEmptyString(characteristicId) &&
    typeof fixed === 'boolean' &&
    typeof required === 'boolean' &&
    (vesselLengthApplicability === undefined ||
      isStringArray(vesselLengthApplicability))
  )
}

function isValidGearItem(entry) {
  if (!isPlainObject(entry)) {
    return false
  }

  const { id, code, name, type, categoryId, pairFishing, active } = entry

  return (
    isNonEmptyString(id) &&
    isNonEmptyString(code) &&
    isNonEmptyString(name) &&
    isNonEmptyString(type) &&
    isNonEmptyString(categoryId) &&
    typeof pairFishing === 'boolean' &&
    typeof active === 'boolean' &&
    Array.isArray(entry.applicableCharacteristics) &&
    entry.applicableCharacteristics.every(isValidApplicableCharacteristic)
  )
}

function isValidCharacteristicCatalogEntry(entry) {
  if (!isPlainObject(entry)) {
    return false
  }

  const { id, code, name, dataType, unit, minValue, maxValue } = entry

  return (
    isNonEmptyString(id) &&
    isNonEmptyString(code) &&
    isNonEmptyString(name) &&
    isNonEmptyString(dataType) &&
    (unit === undefined || isNullableString(unit)) &&
    (minValue === undefined || isNullableFiniteNumber(minValue)) &&
    (maxValue === undefined || isNullableFiniteNumber(maxValue))
  )
}

/**
 * Joins one gear's `applicableCharacteristics` with the collection envelope's `characteristics[]`
 * catalog, producing one resolved, self-contained `characteristics[]` array. An
 * `applicableCharacteristics` entry referencing a `characteristicId` absent from the catalog is treated
 * as inconsistent upstream data (`UPSTREAM_INVALID_RESPONSE`), never silently dropped or repaired.
 *
 * @param {object} gearItem
 * @param {object[]} catalog
 * @returns {object[] | null}
 */
function resolveCharacteristics(gearItem, catalog) {
  const catalogById = new Map(catalog.map((entry) => [entry.id, entry]))

  const resolved = []
  for (const applicable of gearItem.applicableCharacteristics) {
    const definition = catalogById.get(applicable.characteristicId)
    if (!definition) {
      return null
    }

    resolved.push(
      Object.freeze({
        characteristicId: applicable.characteristicId,
        fixed: applicable.fixed,
        required: applicable.required,
        vesselLengthApplicability: Object.freeze([
          ...(applicable.vesselLengthApplicability ?? [])
        ]),
        name: definition.name,
        unit: definition.unit ?? null,
        dataType: definition.dataType,
        minValue: definition.minValue ?? null,
        maxValue: definition.maxValue ?? null
      })
    )
  }

  return resolved
}

/**
 * Validates the full collection envelope returned by the `ids`-filtered gear collection request, then
 * resolves exactly the one matching gear's characteristics against the top-level catalog.
 *
 * @param {unknown} body
 * @returns {object | null} the resolved gear, or `null` for a malformed envelope
 */
function validateAndResolveGearResponse(body) {
  if (!isPlainObject(body)) {
    return null
  }

  const { items, characteristics } = body

  if (
    !Array.isArray(items) ||
    !items.every(isValidGearItem) ||
    !Array.isArray(characteristics) ||
    !characteristics.every(isValidCharacteristicCatalogEntry)
  ) {
    return null
  }

  if (items.length !== 1) {
    // 0 matches is handled by the caller as not-found; >1 matches for a single-ID filter is malformed.
    return items.length === 0 ? { notFound: true } : null
  }

  const [gearItem] = items
  const resolvedCharacteristics = resolveCharacteristics(
    gearItem,
    characteristics
  )
  if (!resolvedCharacteristics) {
    return null
  }

  return Object.freeze({
    id: gearItem.id,
    code: gearItem.code,
    name: gearItem.name,
    type: gearItem.type,
    categoryId: gearItem.categoryId,
    pairFishing: gearItem.pairFishing,
    active: gearItem.active,
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

    const query = `ids=${encodeURIComponent(id)}&includeInactive=true`
    const { status, body } = await httpClient.get({
      path: `${BASE_PATH}?${query}`,
      correlationId
    })

    if (status < 200 || status >= 300) {
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
