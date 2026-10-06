import { isValidStableId } from './stable-id.js'
import {
  invalidReferenceRequestError,
  referenceItemNotFoundError,
  upstreamInvalidResponseError
} from './reference-data-errors.js'
import { isNonEmptyString, isPlainObject } from './response-validators.js'
import { HTTP_STATUS_NOT_FOUND, isSuccessStatus } from './http-status.js'

const BASE_PATH = '/api/v1/reference-data/species'

function isValidCommonName(entry) {
  return (
    isPlainObject(entry) &&
    isNonEmptyString(entry.id) &&
    isNonEmptyString(entry.countryCode) &&
    isNonEmptyString(entry.name)
  )
}

function isValidLocalName(entry) {
  return (
    isPlainObject(entry) &&
    isNonEmptyString(entry.id) &&
    isNonEmptyString(entry.languageCode) &&
    isNonEmptyString(entry.name) &&
    typeof entry.official === 'boolean'
  )
}

function isValidNameArray(value, isValidEntry) {
  return Array.isArray(value) && value.every((entry) => isValidEntry(entry))
}

function hasValidSpeciesScalarFields(body) {
  return (
    isNonEmptyString(body.id) &&
    isNonEmptyString(body.faoCode) &&
    isNonEmptyString(body.scientificName) &&
    typeof body.active === 'boolean'
  )
}

/**
 * @param {unknown} body
 * @returns {{ id: string, faoCode: string, scientificName: string, commonNames: object[], localNames:
 *   object[], active: boolean } | null}
 */
function validateSpeciesResponse(body) {
  if (!isPlainObject(body)) {
    return null
  }

  if (!hasValidSpeciesScalarFields(body)) {
    return null
  }

  if (!isValidNameArray(body.commonNames, isValidCommonName)) {
    return null
  }

  if (!isValidNameArray(body.localNames, isValidLocalName)) {
    return null
  }

  const { id, faoCode, scientificName, commonNames, localNames, active } = body

  return Object.freeze({
    id,
    faoCode,
    scientificName,
    commonNames: Object.freeze(
      commonNames.map((entry) =>
        Object.freeze({
          id: entry.id,
          countryCode: entry.countryCode,
          name: entry.name
        })
      )
    ),
    localNames: Object.freeze(
      localNames.map((entry) =>
        Object.freeze({
          id: entry.id,
          languageCode: entry.languageCode,
          name: entry.name,
          official: entry.official
        })
      )
    ),
    active
  })
}

/**
 * @param {{ httpClient: { get: Function } }} deps
 * @returns {(id: string, options?: { correlationId?: string }) => Promise<object>}
 */
export function createGetSpeciesById({ httpClient }) {
  return async function getSpeciesById(id, { correlationId } = {}) {
    if (!isValidStableId(id)) {
      throw invalidReferenceRequestError('A valid species id is required.')
    }

    const { status, body } = await httpClient.get({
      path: `${BASE_PATH}/${encodeURIComponent(id)}`,
      correlationId
    })

    if (status === HTTP_STATUS_NOT_FOUND) {
      throw referenceItemNotFoundError('species')
    }

    if (!isSuccessStatus(status)) {
      throw upstreamInvalidResponseError(
        new Error(`Unexpected species response status ${status}`)
      )
    }

    const species = validateSpeciesResponse(body)
    if (!species) {
      throw upstreamInvalidResponseError(
        new Error('Malformed species response body')
      )
    }

    return species
  }
}
