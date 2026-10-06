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
const APPLICABLE_CHARACTERISTIC_VALIDATORS = Object.freeze([
  ['id', isNonEmptyString],
  ['characteristicId', isNonEmptyString],
  ['fixed', (value) => typeof value === 'boolean'],
  ['required', (value) => typeof value === 'boolean'],
  [
    'vesselLengthApplicability',
    (value) => isOptionalField(value, isStringArray)
  ]
])

const GEAR_ITEM_VALIDATORS = Object.freeze([
  ['id', isNonEmptyString],
  ['code', isNonEmptyString],
  ['name', isNonEmptyString],
  ['type', isNonEmptyString],
  ['categoryId', isNonEmptyString],
  ['pairFishing', (value) => typeof value === 'boolean'],
  ['active', (value) => typeof value === 'boolean']
])

const CHARACTERISTIC_CATALOG_VALIDATORS = Object.freeze([
  ['id', isNonEmptyString],
  ['code', isNonEmptyString],
  ['name', isNonEmptyString],
  ['dataType', isNonEmptyString],
  ['unit', (value) => isOptionalField(value, isNullableString)],
  ['minValue', (value) => isOptionalField(value, isNullableFiniteNumber)],
  ['maxValue', (value) => isOptionalField(value, isNullableFiniteNumber)]
])

function matchesAllFields(entry, validators) {
  return validators.every(([field, validator]) => validator(entry[field]))
}

function isValidApplicableCharacteristic(entry) {
  return (
    isPlainObject(entry) &&
    matchesAllFields(entry, APPLICABLE_CHARACTERISTIC_VALIDATORS)
  )
}

function isValidGearItem(entry) {
  if (!isPlainObject(entry) || !matchesAllFields(entry, GEAR_ITEM_VALIDATORS)) {
    return false
  }

  return (
    Array.isArray(entry.applicableCharacteristics) &&
    entry.applicableCharacteristics.every(isValidApplicableCharacteristic)
  )
}

function isValidCharacteristicCatalogEntry(entry) {
  return (
    isPlainObject(entry) &&
    matchesAllFields(entry, CHARACTERISTIC_CATALOG_VALIDATORS)
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
