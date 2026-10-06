import { isValidStableId } from './stable-id.js'
import {
  invalidReferenceRequestError,
  referenceItemNotFoundError,
  upstreamInvalidResponseError
} from './reference-data-errors.js'
import {
  isNonEmptyString,
  isNullableString,
  isFiniteNumber,
  isPlainObject
} from './response-validators.js'

const BASE_PATH = '/api/v1/reference-data/vessels'

function isValidIdentifiers(identifiers) {
  if (!isPlainObject(identifiers)) {
    return false
  }

  return [
    'cfr',
    'uvi',
    'mmsi',
    'ircs',
    'externalMark',
    'registrationNumber'
  ].every((field) => {
    const value = identifiers[field]
    return value === undefined || isNullableString(value)
  })
}

/**
 * Hand-rolled, field-by-field response validator for a single vessel item - never silently repairs,
 * coerces, or fills a missing field. Unknown extra fields are ignored (never copied into the result).
 *
 * @param {unknown} body
 * @returns {{ id: string, name: string, namePln: string|null, identifiers: object, lengthOverallMetres:
 *   number, status: string, activeFrom: string, activeTo: string|null } | null}
 */
function validateVesselResponse(body) {
  if (!isPlainObject(body)) {
    return null
  }

  const {
    id,
    name,
    namePln = null,
    identifiers,
    lengthOverallMetres,
    status,
    activeFrom,
    activeTo = null
  } = body

  if (
    !isNonEmptyString(id) ||
    !isNonEmptyString(name) ||
    !isNullableString(namePln) ||
    !isValidIdentifiers(identifiers) ||
    !isFiniteNumber(lengthOverallMetres) ||
    !isNonEmptyString(status) ||
    !isNonEmptyString(activeFrom) ||
    !isNullableString(activeTo)
  ) {
    return null
  }

  return Object.freeze({
    id,
    name,
    namePln,
    identifiers: Object.freeze({
      cfr: identifiers.cfr ?? null,
      uvi: identifiers.uvi ?? null,
      mmsi: identifiers.mmsi ?? null,
      ircs: identifiers.ircs ?? null,
      externalMark: identifiers.externalMark ?? null,
      registrationNumber: identifiers.registrationNumber ?? null
    }),
    lengthOverallMetres,
    status,
    activeFrom,
    activeTo
  })
}

/**
 * @param {{ httpClient: { get: Function } }} deps
 * @returns {(id: string, options?: { correlationId?: string }) => Promise<object>}
 */
export function createGetVesselById({ httpClient }) {
  return async function getVesselById(id, { correlationId } = {}) {
    if (!isValidStableId(id)) {
      throw invalidReferenceRequestError('A valid vessel id is required.')
    }

    const { status, body } = await httpClient.get({
      path: `${BASE_PATH}/${encodeURIComponent(id)}`,
      correlationId
    })

    if (status === 404) {
      throw referenceItemNotFoundError('vessel')
    }

    if (status < 200 || status >= 300) {
      throw upstreamInvalidResponseError(
        new Error(`Unexpected vessel response status ${status}`)
      )
    }

    const vessel = validateVesselResponse(body)
    if (!vessel) {
      throw upstreamInvalidResponseError(
        new Error('Malformed vessel response body')
      )
    }

    return vessel
  }
}
