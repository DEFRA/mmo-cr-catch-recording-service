import {
  isDuplicateIdempotencyClaimError,
  idempotencyConflictError,
  idempotencyClaimNotFoundError,
  malformedIdempotencyClaimDocumentError,
  unexpectedIdempotencyPersistenceError
} from './catch-idempotency-errors.js'

function buildDuplicateKeyError() {
  const error = new Error(
    'E11000 duplicate key error collection: catch-idempotency-claims'
  )
  error.code = 11000
  return error
}

describe('#catch-idempotency-errors', () => {
  describe('isDuplicateIdempotencyClaimError', () => {
    test('Should return true for a MongoDB duplicate-key error', () => {
      expect(isDuplicateIdempotencyClaimError(buildDuplicateKeyError())).toBe(
        true
      )
    })

    test.each([
      ['undefined', undefined],
      ['null', null],
      ['a different error code', Object.assign(new Error('x'), { code: 123 })],
      ['an error with no code', new Error('x')]
    ])('Should return false for %s', (_description, value) => {
      expect(isDuplicateIdempotencyClaimError(value)).toBe(false)
    })
  })

  describe('idempotencyConflictError', () => {
    test('Should return a safe IDEMPOTENCY_CONFLICT ApplicationError', () => {
      const error = idempotencyConflictError()

      expect(error.category).toBe('IDEMPOTENCY_CONFLICT')
      expect(error.code).toBe('IDEMPOTENCY_REQUEST_MISMATCH')
      expect(error.message).not.toMatch(
        /catch-idempotency-claims|mongo|fingerprint|ownerUserId/i
      )
    })
  })

  describe('idempotencyClaimNotFoundError', () => {
    test('Should return a safe UNEXPECTED_INTERNAL_FAILURE ApplicationError', () => {
      const error = idempotencyClaimNotFoundError()

      expect(error.category).toBe('UNEXPECTED_INTERNAL_FAILURE')
      expect(error.code).toBe('IDEMPOTENCY_CLAIM_NOT_FOUND')
    })
  })

  describe('malformedIdempotencyClaimDocumentError', () => {
    test('Should return a safe ApplicationError carrying the cause internally only', () => {
      const cause = new Error('malformed document')
      const error = malformedIdempotencyClaimDocumentError(cause)

      expect(error.category).toBe('UNEXPECTED_INTERNAL_FAILURE')
      expect(error.code).toBe('MALFORMED_IDEMPOTENCY_CLAIM_DOCUMENT')
      expect(JSON.stringify(error)).not.toMatch(/malformed document/)
    })
  })

  describe('unexpectedIdempotencyPersistenceError', () => {
    test('Should return a safe ApplicationError carrying the cause internally only', () => {
      const cause = buildDuplicateKeyError()
      const error = unexpectedIdempotencyPersistenceError(cause)

      expect(error.category).toBe('UNEXPECTED_INTERNAL_FAILURE')
      expect(error.code).toBe('IDEMPOTENCY_PERSISTENCE_FAILURE')
      expect(JSON.stringify(error)).not.toMatch(/E11000/)
    })
  })
})
