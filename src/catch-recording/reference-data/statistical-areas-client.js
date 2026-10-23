import { isValidStableId } from './stable-id.js'
import {
  invalidReferenceRequestError,
  referenceItemNotFoundError,
  upstreamInvalidResponseError
} from './reference-data-errors.js'
import {
  isNonEmptyString,
  isFiniteNumber,
  isPlainObject
} from './response-validators.js'
import { HTTP_STATUS_NOT_FOUND, isSuccessStatus } from './http-status.js'

const BASE_PATH = '/api/v1/reference-data/map/statistical-areas'

function isNonNegativeInteger(value) {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

// Declarative field validators: reduces both the single-expression conditional-operator count and the
// function's cyclomatic complexity compared with one large `||` chain, without changing behaviour.
// Field names match the raw ArcGIS `StatisticalAreaProperties` contract this dataset is served as
// (Step 42) - `OBJECTID`, `ICESNAME`, `sub_code`, `AREA_KM2` - never the camelCase shape used by every
// other reference-data resource.
const AREA_PROPERTY_VALIDATORS = Object.freeze([
  ['OBJECTID', isNonNegativeInteger],
  ['ICESNAME', isNonEmptyString],
  ['sub_code', isNonEmptyString],
  ['AREA_KM2', isFiniteNumber]
])

function hasValidAreaProperties(properties) {
  return AREA_PROPERTY_VALIDATORS.every(([field, validator]) =>
    validator(properties[field])
  )
}

/**
 * Statistical areas have no active/inactive field in the confirmed Reference Data Service schema -
 * every returned item is treated as active, so no active-selection check applies to this type.
 *
 * The upstream response is the raw ArcGIS export (Step 42): `OBJECTID`, `ICESNAME`, `sub_code`,
 * `AREA_KM2`, plus several geometry-bound fields this client never reads. It carries no GUID, `code`, or
 * `name` field. The client still returns the same `{ id, code, name, areaKm2, geometry }` shape every
 * caller already expects, sourced from the nearest equivalent raw field (`OBJECTID` -> `id`, `sub_code`
 * -> `code`, `ICESNAME` -> `name`, `AREA_KM2` -> `areaKm2`) - the former `areaType`/`parentCode`/
 * `parentName`/`centroid` fields no longer exist upstream and are never read.
 *
 * @param {unknown} body
 * @returns {{ id: string, code: string, name: string, areaKm2: number, geometry: object } | null}
 */
function validateStatisticalAreaResponse(body) {
  if (!isPlainObject(body) || body.type !== 'Feature') {
    return null
  }

  const { properties, geometry } = body

  if (!isPlainObject(properties) || !isPlainObject(geometry)) {
    return null
  }

  if (!hasValidAreaProperties(properties)) {
    return null
  }

  const {
    OBJECTID: objectId,
    ICESNAME: icesName,
    sub_code: subCode,
    AREA_KM2: areaKm2
  } = properties

  return Object.freeze({
    id: String(objectId),
    code: subCode,
    name: icesName,
    areaKm2,
    // Passed through opaquely - no current consumer parses or reinterprets geometry.
    geometry: Object.freeze({ ...geometry })
  })
}

/**
 * @param {{ httpClient: { get: Function } }} deps
 * @returns {(id: string, options?: { correlationId?: string }) => Promise<object>}
 */
export function createGetStatisticalAreaById({ httpClient }) {
  return async function getStatisticalAreaById(id, { correlationId } = {}) {
    if (!isValidStableId(id)) {
      throw invalidReferenceRequestError(
        'A valid statistical area id is required.'
      )
    }

    const { status, body } = await httpClient.get({
      path: `${BASE_PATH}/${encodeURIComponent(id)}`,
      correlationId
    })

    if (status === HTTP_STATUS_NOT_FOUND) {
      throw referenceItemNotFoundError('statistical area')
    }

    if (!isSuccessStatus(status)) {
      throw upstreamInvalidResponseError(
        new Error(`Unexpected statistical area response status ${status}`)
      )
    }

    const statisticalArea = validateStatisticalAreaResponse(body)
    if (!statisticalArea) {
      throw upstreamInvalidResponseError(
        new Error('Malformed statistical area response body')
      )
    }

    return statisticalArea
  }
}
