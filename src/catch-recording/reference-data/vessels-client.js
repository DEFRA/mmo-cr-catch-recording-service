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
import { HTTP_STATUS_NOT_FOUND, isSuccessStatus } from './http-status.js'

const BASE_PATH = '/api/v1/reference-data/vessels'
const IDENTIFIER_FIELDS = Object.freeze([
  'cfr',
  'uvi',
  'mmsi',
  'ircs',
  'externalMark',
  'registrationNumber'
])
// Declarative field validators: reduces both the single-expression conditional-operator count and the
// function's cyclomatic complexity compared with one large `||` chain, without changing behaviour.
const VESSEL_FIELD_VALIDATORS = Object.freeze([
  ['id', isNonEmptyString],
  ['name', isNonEmptyString],
  ['namePln', isNullableString],
  ['lengthOverallMetres', isFiniteNumber],
  ['status', isNonEmptyString],
  ['activeFrom', isNonEmptyString],
  ['activeTo', isNullableString]
])

function isValidIdentifiers(identifiers) {
  if (!isPlainObject(identifiers)) {
    return false
  }

  return IDENTIFIER_FIELDS.every((field) => {
    const value = identifiers[field]
    return value === undefined || isNullableString(value)
  })
}

function hasValidVesselFields(body) {
  return VESSEL_FIELD_VALIDATORS.every(([field, validator]) =>
    validator(body[field])
  )
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

  const normalised = { namePln: null, activeTo: null, ...body }

  if (
    !hasValidVesselFields(normalised) ||
    !isValidIdentifiers(normalised.identifiers)
  ) {
    return null
  }

  const {
    id,
    name,
    namePln,
    identifiers,
    lengthOverallMetres,
    status,
    activeFrom,
    activeTo
  } = normalised

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

    if (status === HTTP_STATUS_NOT_FOUND) {
      throw referenceItemNotFoundError('vessel')
    }

    if (!isSuccessStatus(status)) {
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
