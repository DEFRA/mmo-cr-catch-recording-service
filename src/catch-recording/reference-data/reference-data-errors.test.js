import {
  invalidReferenceRequestError,
  referenceItemNotFoundError,
  upstreamInvalidResponseError,
  dependencyUnavailableError,
  upstreamTimeoutError
} from './reference-data-errors.js'
import { isApplicationError } from '#/common/helpers/errors/application-error.js'

describe('#reference-data-errors', () => {
  test('invalidReferenceRequestError should produce an INVALID_REQUEST error', () => {
    const error = invalidReferenceRequestError('bad id')

    expect(isApplicationError(error)).toBe(true)
    expect(error.category).toBe('INVALID_REQUEST')
    expect(error.message).toBe('bad id')
  })

  test('referenceItemNotFoundError should produce a safe RESOURCE_NOT_FOUND error without the raw id', () => {
    const error = referenceItemNotFoundError('vessel')

    expect(isApplicationError(error)).toBe(true)
    expect(error.category).toBe('RESOURCE_NOT_FOUND')
    expect(error.message).toContain('vessel')
    expect(error.message).not.toContain('SENTINEL-ID')
  })

  test('upstreamInvalidResponseError should produce a safe UPSTREAM_INVALID_RESPONSE error', () => {
    const error = upstreamInvalidResponseError(new Error('SENTINEL-CAUSE'))

    expect(isApplicationError(error)).toBe(true)
    expect(error.category).toBe('UPSTREAM_INVALID_RESPONSE')
    expect(JSON.stringify(error.toJSON())).not.toContain('SENTINEL-CAUSE')
  })

  test('dependencyUnavailableError should produce a safe DEPENDENCY_UNAVAILABLE error', () => {
    const error = dependencyUnavailableError(new Error('SENTINEL-CAUSE'))

    expect(isApplicationError(error)).toBe(true)
    expect(error.category).toBe('DEPENDENCY_UNAVAILABLE')
    expect(JSON.stringify(error.toJSON())).not.toContain('SENTINEL-CAUSE')
  })

  test('upstreamTimeoutError should produce a safe UPSTREAM_TIMEOUT error', () => {
    const error = upstreamTimeoutError(new Error('SENTINEL-CAUSE'))

    expect(isApplicationError(error)).toBe(true)
    expect(error.category).toBe('UPSTREAM_TIMEOUT')
    expect(JSON.stringify(error.toJSON())).not.toContain('SENTINEL-CAUSE')
  })
})
