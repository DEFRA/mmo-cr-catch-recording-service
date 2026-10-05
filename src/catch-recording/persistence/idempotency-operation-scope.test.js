import {
  IDEMPOTENCY_OPERATION_SCOPES,
  isSupportedIdempotencyOperationScope,
  validateOperationScope
} from './idempotency-operation-scope.js'

describe('#idempotency-operation-scope', () => {
  test('Should expose exactly the seven approved operation scopes', () => {
    expect(Object.keys(IDEMPOTENCY_OPERATION_SCOPES).sort()).toEqual(
      [
        'ADD_FAVOURITE',
        'ADD_SKIPPER',
        'COMPLETION',
        'DRAFT_CREATION',
        'EDIT_START',
        'RESUBMISSION',
        'SUBMISSION'
      ].sort()
    )
  })

  test('Should be a frozen object', () => {
    expect(Object.isFrozen(IDEMPOTENCY_OPERATION_SCOPES)).toBe(true)
  })

  describe('isSupportedIdempotencyOperationScope', () => {
    test.each(Object.values(IDEMPOTENCY_OPERATION_SCOPES))(
      'Should accept %s',
      (scope) => {
        expect(isSupportedIdempotencyOperationScope(scope)).toBe(true)
      }
    )

    test.each([
      ['an arbitrary string', 'SOMETHING_ELSE'],
      ['undefined', undefined],
      ['null', null],
      ['an object', {}],
      ['a lower-case variant', 'draft_creation'],
      ['a generic ANY scope', 'ANY'],
      ['a section-save scope', 'SECTION_SAVE']
    ])('Should reject %s', (_description, value) => {
      expect(isSupportedIdempotencyOperationScope(value)).toBe(false)
    })
  })

  describe('validateOperationScope', () => {
    test('Should return a valid scope unchanged', () => {
      expect(
        validateOperationScope(IDEMPOTENCY_OPERATION_SCOPES.SUBMISSION)
      ).toBe('SUBMISSION')
    })

    test('Should reject an unsupported scope', () => {
      expect(() => validateOperationScope('SECTION_SAVE')).toThrow(TypeError)
    })
  })
})
