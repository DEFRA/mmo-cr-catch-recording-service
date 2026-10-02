import {
  APPLICATION_ERROR_CATEGORIES,
  CATEGORY_HTTP_STATUS,
  CATEGORY_FALLBACK_CODE,
  isApplicationErrorCategory
} from './error-categories.js'

describe('#error-categories', () => {
  test('Should expose the approved 14 categories', () => {
    expect(APPLICATION_ERROR_CATEGORIES).toHaveLength(14)
    expect(Object.isFrozen(APPLICATION_ERROR_CATEGORIES)).toBe(true)
  })

  test('Should define an HTTP status for every category', () => {
    expect(Object.keys(CATEGORY_HTTP_STATUS).sort()).toEqual(
      [...APPLICATION_ERROR_CATEGORIES].sort()
    )
    expect(Object.isFrozen(CATEGORY_HTTP_STATUS)).toBe(true)
  })

  test('Should define a fallback code for every category', () => {
    expect(Object.keys(CATEGORY_FALLBACK_CODE).sort()).toEqual(
      [...APPLICATION_ERROR_CATEGORIES].sort()
    )
    expect(Object.isFrozen(CATEGORY_FALLBACK_CODE)).toBe(true)
  })

  test.each([
    ['INVALID_REQUEST', 400, 'INVALID_REQUEST'],
    ['AUTHENTICATION_FAILURE', 401, 'AUTHENTICATION_REQUIRED'],
    ['AUTHORISATION_FAILURE', 403, 'ACCESS_DENIED'],
    ['RESOURCE_NOT_FOUND', 404, 'RESOURCE_NOT_FOUND'],
    ['VERSION_CONFLICT', 409, 'VERSION_CONFLICT'],
    ['INVALID_LIFECYCLE_TRANSITION', 409, 'INVALID_LIFECYCLE_TRANSITION'],
    ['BUSINESS_VALIDATION_FAILURE', 422, 'BUSINESS_VALIDATION_FAILED'],
    ['DUPLICATE_RESOURCE', 409, 'DUPLICATE_RESOURCE'],
    ['IDEMPOTENCY_CONFLICT', 409, 'IDEMPOTENCY_CONFLICT'],
    ['UPSTREAM_TIMEOUT', 504, 'UPSTREAM_TIMEOUT'],
    ['UPSTREAM_INVALID_RESPONSE', 502, 'UPSTREAM_INVALID_RESPONSE'],
    ['DEPENDENCY_UNAVAILABLE', 503, 'DEPENDENCY_UNAVAILABLE'],
    ['ARTIFACT_OPERATION_FAILURE', 500, 'ARTIFACT_OPERATION_FAILED'],
    ['UNEXPECTED_INTERNAL_FAILURE', 500, 'INTERNAL_SERVER_ERROR']
  ])(
    'Should map %s to status %i and fallback code %s',
    (category, expectedStatus, expectedCode) => {
      expect(CATEGORY_HTTP_STATUS[category]).toBe(expectedStatus)
      expect(CATEGORY_FALLBACK_CODE[category]).toBe(expectedCode)
    }
  )

  test('Should recognise an approved category', () => {
    expect(isApplicationErrorCategory('RESOURCE_NOT_FOUND')).toBe(true)
  })

  test('Should reject an unapproved category', () => {
    expect(isApplicationErrorCategory('SOMETHING_MADE_UP')).toBe(false)
    expect(isApplicationErrorCategory(undefined)).toBe(false)
  })
})
