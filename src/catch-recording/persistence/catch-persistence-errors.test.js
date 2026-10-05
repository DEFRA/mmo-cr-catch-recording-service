import { ApplicationError } from '#/common/helpers/errors/application-error.js'
import {
  malformedDocumentError,
  translateInsertError,
  unexpectedPersistenceError,
  versionConflictError
} from './catch-persistence-errors.js'

function duplicateKeyError(keyPattern) {
  const error = new Error('E11000 duplicate key error')
  error.code = 11000
  error.keyPattern = keyPattern
  return error
}

describe('#catch-persistence-errors', () => {
  describe('translateInsertError', () => {
    test('Should translate a duplicate _id into DUPLICATE_RESOURCE/DUPLICATE_CATCH_RECORD_ID', () => {
      const error = translateInsertError(duplicateKeyError({ _id: 1 }))

      expect(error).toBeInstanceOf(ApplicationError)
      expect(error.category).toBe('DUPLICATE_RESOURCE')
      expect(error.code).toBe('DUPLICATE_CATCH_RECORD_ID')
      expect(error.message).not.toMatch(/catch-records|mongo|E11000/i)
    })

    test('Should translate a duplicate reference into DUPLICATE_RESOURCE/DUPLICATE_CATCH_RECORD_REFERENCE', () => {
      const error = translateInsertError(
        duplicateKeyError({ catchRecordReference: 1 })
      )

      expect(error).toBeInstanceOf(ApplicationError)
      expect(error.category).toBe('DUPLICATE_RESOURCE')
      expect(error.code).toBe('DUPLICATE_CATCH_RECORD_REFERENCE')
    })

    test('Should translate any other failure as an unexpected persistence error', () => {
      const error = translateInsertError(new Error('connection reset'))

      expect(error).toBeInstanceOf(ApplicationError)
      expect(error.category).toBe('UNEXPECTED_INTERNAL_FAILURE')
      expect(error.code).toBe('CATCH_RECORD_PERSISTENCE_FAILURE')
      expect(error.message).not.toMatch(/connection reset/)
    })

    test('Should translate a duplicate-key error on an unrecognised index safely', () => {
      // A duplicate-key error whose keyPattern names neither `_id` nor `catchRecordReference` (or has
      // no keyPattern at all) must not be misclassified as one of the two known duplicate outcomes.
      const error = duplicateKeyError(undefined)
      error.keyPattern = undefined

      const translated = translateInsertError(error)

      expect(translated).toBeInstanceOf(ApplicationError)
      expect(translated.category).toBe('UNEXPECTED_INTERNAL_FAILURE')
      expect(translated.code).toBe('CATCH_RECORD_PERSISTENCE_FAILURE')
    })

    test('Should not expose the raw cause publicly (toJSON)', () => {
      const error = translateInsertError(duplicateKeyError({ _id: 1 }))

      expect(JSON.stringify(error)).not.toMatch(/E11000/)
      expect(Object.keys(error.toJSON())).not.toContain('cause')
    })
  })

  describe('malformedDocumentError', () => {
    test('Should build a safe UNEXPECTED_INTERNAL_FAILURE error without exposing the document', () => {
      const cause = new TypeError(
        'Stored catch record document has an invalid status'
      )
      const error = malformedDocumentError(cause)

      expect(error).toBeInstanceOf(ApplicationError)
      expect(error.category).toBe('UNEXPECTED_INTERNAL_FAILURE')
      expect(error.code).toBe('MALFORMED_CATCH_RECORD_DOCUMENT')
    })
  })

  describe('unexpectedPersistenceError', () => {
    test('Should build a safe UNEXPECTED_INTERNAL_FAILURE error', () => {
      const error = unexpectedPersistenceError(new Error('boom'))

      expect(error).toBeInstanceOf(ApplicationError)
      expect(error.category).toBe('UNEXPECTED_INTERNAL_FAILURE')
      expect(error.code).toBe('CATCH_RECORD_PERSISTENCE_FAILURE')
    })
  })

  describe('versionConflictError', () => {
    test('Should build a safe, deterministic VERSION_CONFLICT error reusing the Step 03 category', () => {
      const error = versionConflictError()

      expect(error).toBeInstanceOf(ApplicationError)
      expect(error.category).toBe('VERSION_CONFLICT')
      expect(error.code).toBe('CATCH_RECORD_VERSION_CONFLICT')
    })

    test('Should never include a record ID, owner ID, or version number in the public message', () => {
      const error = versionConflictError()

      expect(error.message).not.toMatch(
        /owner|version-?\d|[0-9a-f]{8}-[0-9a-f]{4}/i
      )
    })

    test('Should carry no cause (a deterministic business outcome, not a translated driver failure)', () => {
      const error = versionConflictError()

      expect(error.cause).toBeUndefined()
    })
  })
})
