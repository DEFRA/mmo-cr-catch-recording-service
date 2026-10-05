import {
  ERROR_CATEGORIES,
  getCategoryDefinition,
  isSupportedCategory
} from './error-categories.js'

const EXPECTED = {
  INVALID_REQUEST: { status: 400, fallbackCode: 'INVALID_REQUEST' },
  AUTHENTICATION_FAILURE: {
    status: 401,
    fallbackCode: 'AUTHENTICATION_REQUIRED'
  },
  AUTHORISATION_FAILURE: { status: 403, fallbackCode: 'ACCESS_DENIED' },
  RESOURCE_NOT_FOUND: { status: 404, fallbackCode: 'RESOURCE_NOT_FOUND' },
  VERSION_CONFLICT: { status: 409, fallbackCode: 'VERSION_CONFLICT' },
  INVALID_LIFECYCLE_TRANSITION: {
    status: 409,
    fallbackCode: 'INVALID_LIFECYCLE_TRANSITION'
  },
  DUPLICATE_RESOURCE: { status: 409, fallbackCode: 'DUPLICATE_RESOURCE' },
  IDEMPOTENCY_CONFLICT: { status: 409, fallbackCode: 'IDEMPOTENCY_CONFLICT' },
  BUSINESS_VALIDATION_FAILURE: {
    status: 422,
    fallbackCode: 'BUSINESS_VALIDATION_FAILED'
  },
  UPSTREAM_INVALID_RESPONSE: {
    status: 502,
    fallbackCode: 'UPSTREAM_INVALID_RESPONSE'
  },
  DEPENDENCY_UNAVAILABLE: {
    status: 503,
    fallbackCode: 'DEPENDENCY_UNAVAILABLE'
  },
  UPSTREAM_TIMEOUT: { status: 504, fallbackCode: 'UPSTREAM_TIMEOUT' },
  ARTIFACT_OPERATION_FAILURE: {
    status: 500,
    fallbackCode: 'ARTIFACT_OPERATION_FAILED'
  },
  UNEXPECTED_INTERNAL_FAILURE: {
    status: 500,
    fallbackCode: 'INTERNAL_SERVER_ERROR'
  }
}

describe('#error-categories', () => {
  test('Should expose exactly the approved fourteen categories', () => {
    expect(Object.keys(ERROR_CATEGORIES).sort()).toEqual(
      Object.keys(EXPECTED).sort()
    )
  })

  test.each(Object.entries(EXPECTED))(
    'Should map %s to the approved status and fallback code',
    (category, expected) => {
      expect(getCategoryDefinition(category)).toEqual(expected)
    }
  )

  test('Should report every approved category as supported', () => {
    for (const category of Object.keys(EXPECTED)) {
      expect(isSupportedCategory(category)).toBe(true)
    }
  })

  test('Should reject an unsupported category', () => {
    expect(isSupportedCategory('NOT_A_CATEGORY')).toBe(false)
    expect(getCategoryDefinition('NOT_A_CATEGORY')).toBeUndefined()
  })

  test('Should reject a non-string category', () => {
    expect(isSupportedCategory(undefined)).toBe(false)
    expect(isSupportedCategory(null)).toBe(false)
    expect(isSupportedCategory(42)).toBe(false)
  })

  test('Should not allow the catalogue to be mutated', () => {
    expect(() => {
      ERROR_CATEGORIES.INVALID_REQUEST.status = 999
    }).toThrow()

    expect(() => {
      ERROR_CATEGORIES.NEW_CATEGORY = { status: 999, fallbackCode: 'NEW' }
    }).toThrow()
  })
})
