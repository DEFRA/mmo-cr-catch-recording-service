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

const BASE_PATH = '/api/v1/reference-data/ports'

function isValidCoordinate(coordinate) {
  if (coordinate === null) {
    return true
  }
  return (
    isPlainObject(coordinate) &&
    isFiniteNumber(coordinate.latitude) &&
    isFiniteNumber(coordinate.longitude)
  )
}

/**
 * @param {unknown} body
 * @returns {{ id: string, code: string, name: string, countryCode: string, coordinate: object|null,
 *   active: boolean } | null}
 */
function validatePortResponse(body) {
  if (!isPlainObject(body)) {
    return null
  }

  const { id, code, name, countryCode, coordinate = null, active } = body

  if (
    !isNonEmptyString(id) ||
    !isNonEmptyString(code) ||
    !isNonEmptyString(name) ||
    !isNonEmptyString(countryCode) ||
    !isValidCoordinate(coordinate) ||
    typeof active !== 'boolean'
  ) {
    return null
  }

  return Object.freeze({
    id,
    code,
    name,
    countryCode,
    coordinate: coordinate
      ? Object.freeze({
          latitude: coordinate.latitude,
          longitude: coordinate.longitude
        })
      : null,
    active
  })
}

/**
 * @param {{ httpClient: { get: Function } }} deps
 * @returns {(id: string, options?: { correlationId?: string }) => Promise<object>}
 */
export function createGetPortById({ httpClient }) {
  return async function getPortById(id, { correlationId } = {}) {
    if (!isValidStableId(id)) {
      throw invalidReferenceRequestError('A valid port id is required.')
    }

    const { status, body } = await httpClient.get({
      path: `${BASE_PATH}/${encodeURIComponent(id)}`,
      correlationId
    })

    if (status === HTTP_STATUS_NOT_FOUND) {
      throw referenceItemNotFoundError('port')
    }

    if (!isSuccessStatus(status)) {
      throw upstreamInvalidResponseError(
        new Error(`Unexpected port response status ${status}`)
      )
    }

    const port = validatePortResponse(body)
    if (!port) {
      throw upstreamInvalidResponseError(
        new Error('Malformed port response body')
      )
    }

    return port
  }
}
