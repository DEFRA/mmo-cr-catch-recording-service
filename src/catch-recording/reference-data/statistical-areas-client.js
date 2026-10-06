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
  isPlainObject
} from './response-validators.js'

const BASE_PATH = '/api/v1/reference-data/map/statistical-areas'

/**
 * Statistical areas have no active/inactive field in the confirmed Reference Data Service schema -
 * every returned item is treated as active, so no active-selection check applies to this type.
 *
 * @param {unknown} body
 * @returns {{ id: string, code: string, name: string, areaType: string, parentCode: string|null,
 *   parentName: string|null, areaKm2: number|null, geometry: object } | null}
 */
function validateStatisticalAreaResponse(body) {
  if (!isPlainObject(body) || body.type !== 'Feature') {
    return null
  }

  const { properties, geometry } = body

  if (!isPlainObject(properties) || !isPlainObject(geometry)) {
    return null
  }

  const {
    id,
    code,
    name,
    areaType,
    parentCode = null,
    parentName = null,
    areaKm2 = null
  } = properties

  if (
    !isNonEmptyString(id) ||
    !isNonEmptyString(code) ||
    !isNonEmptyString(name) ||
    !isNonEmptyString(areaType) ||
    !isNullableString(parentCode) ||
    !isNullableString(parentName) ||
    !isNullableFiniteNumber(areaKm2)
  ) {
    return null
  }

  return Object.freeze({
    id,
    code,
    name,
    areaType,
    parentCode,
    parentName,
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

    if (status === 404) {
      throw referenceItemNotFoundError('statistical area')
    }

    if (status < 200 || status >= 300) {
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
