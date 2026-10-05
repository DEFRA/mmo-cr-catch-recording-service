import {
  malformedHistoryDocumentError,
  unexpectedHistoryPersistenceError
} from './catch-history-errors.js'
import { ApplicationError } from '#/common/helpers/errors/application-error.js'

describe('#catch-history-errors', () => {
  describe('malformedHistoryDocumentError', () => {
    test('Should return an ApplicationError with the approved category/code', () => {
      const error = malformedHistoryDocumentError(new Error('raw mongo detail'))

      expect(error).toBeInstanceOf(ApplicationError)
      expect(error.category).toBe('UNEXPECTED_INTERNAL_FAILURE')
      expect(error.code).toBe('MALFORMED_HISTORY_EVENT_DOCUMENT')
    })

    test('Should never expose the raw cause in the public message or toJSON', () => {
      const cause = new Error(
        'collection catch-record-history: raw mongo detail'
      )
      const error = malformedHistoryDocumentError(cause)

      expect(error.message).not.toContain('raw mongo detail')
      expect(error.message).not.toContain('catch-record-history')
      expect(JSON.stringify(error.toJSON())).not.toContain('raw mongo detail')
    })

    test('Should carry the cause only as a non-enumerable diagnostic field', () => {
      const cause = new Error('internal detail')
      const error = malformedHistoryDocumentError(cause)

      expect(error.cause).toBe(cause)
      expect(Object.keys(error)).not.toContain('cause')
    })
  })

  describe('unexpectedHistoryPersistenceError', () => {
    test('Should return an ApplicationError with the approved category/code', () => {
      const error = unexpectedHistoryPersistenceError(
        new Error('connection reset')
      )

      expect(error).toBeInstanceOf(ApplicationError)
      expect(error.category).toBe('UNEXPECTED_INTERNAL_FAILURE')
      expect(error.code).toBe('CATCH_RECORD_HISTORY_PERSISTENCE_FAILURE')
    })

    test('Should never expose the raw cause in the public message or toJSON', () => {
      const cause = new Error('mongodb://user:pass@host/db connection failure')
      const error = unexpectedHistoryPersistenceError(cause)

      expect(error.message).not.toContain('mongodb://')
      expect(JSON.stringify(error.toJSON())).not.toContain('mongodb://')
    })
  })
})
