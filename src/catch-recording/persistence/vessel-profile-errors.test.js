import {
  isDuplicateProfileKeyError,
  malformedVesselProfileDocumentError,
  unexpectedVesselProfilePersistenceError
} from './vessel-profile-errors.js'

describe('#vessel-profile-errors', () => {
  test('isDuplicateProfileKeyError should recognise a MongoDB duplicate-key error', () => {
    expect(isDuplicateProfileKeyError({ code: 11000 })).toBe(true)
    expect(isDuplicateProfileKeyError({ code: 12345 })).toBe(false)
    expect(isDuplicateProfileKeyError(null)).toBe(false)
  })

  test('malformedVesselProfileDocumentError should never expose the cause content', () => {
    const cause = new Error('raw stored document detail')

    const error = malformedVesselProfileDocumentError(cause)

    expect(error.category).toBe('UNEXPECTED_INTERNAL_FAILURE')
    expect(error.code).toBe('MALFORMED_VESSEL_PROFILE_DOCUMENT')
    expect(error.message).not.toContain('raw stored document detail')
  })

  test('unexpectedVesselProfilePersistenceError should map to UNEXPECTED_INTERNAL_FAILURE', () => {
    const error = unexpectedVesselProfilePersistenceError(new Error('boom'))

    expect(error.category).toBe('UNEXPECTED_INTERNAL_FAILURE')
    expect(error.code).toBe('VESSEL_PROFILE_PERSISTENCE_FAILURE')
  })
})
