import {
  combineValidationResults,
  createValidationError,
  createValidationResult,
  indexPath,
  joinPath
} from './catch-record-validation-result.js'

describe('#createValidationError', () => {
  test('Should build an error with code, path and message', () => {
    expect(
      createValidationError('REQUIRED_FIELD', 'vessel.id', 'Required.')
    ).toEqual({
      code: 'REQUIRED_FIELD',
      path: 'vessel.id',
      message: 'Required.'
    })
  })

  test('Should include frozen metadata when supplied', () => {
    const error = createValidationError(
      'COLLECTION_TOO_LARGE',
      'gear',
      'Too many.',
      {
        max: 10
      }
    )

    expect(error.metadata).toEqual({ max: 10 })
    expect(Object.isFrozen(error.metadata)).toBe(true)
  })

  test('Should be frozen', () => {
    expect(
      Object.isFrozen(createValidationError('REQUIRED_FIELD', 'a', 'b'))
    ).toBe(true)
  })

  test('Should reject an unsupported code', () => {
    expect(() => createValidationError('NOT_A_CODE', 'a', 'b')).toThrow()
  })

  test('Should not include a metadata key when none is supplied', () => {
    expect(
      createValidationError('REQUIRED_FIELD', 'a', 'b')
    ).not.toHaveProperty('metadata')
  })
})

describe('#createValidationResult', () => {
  test('Should be valid with no errors', () => {
    expect(createValidationResult()).toEqual({ isValid: true, errors: [] })
  })

  test('Should be invalid when errors are supplied', () => {
    const error = createValidationError('REQUIRED_FIELD', 'a', 'b')
    const result = createValidationResult([error])

    expect(result.isValid).toBe(false)
    expect(result.errors).toEqual([error])
  })

  test('Should return a frozen result and errors array', () => {
    const result = createValidationResult()

    expect(Object.isFrozen(result)).toBe(true)
    expect(Object.isFrozen(result.errors)).toBe(true)
  })
})

describe('#combineValidationResults', () => {
  test('Should concatenate errors in call order', () => {
    const first = createValidationResult([
      createValidationError('REQUIRED_FIELD', 'a', 'A')
    ])
    const second = createValidationResult([
      createValidationError('REQUIRED_FIELD', 'b', 'B')
    ])

    const combined = combineValidationResults(first, second)

    expect(combined.errors.map((e) => e.path)).toEqual(['a', 'b'])
    expect(combined.isValid).toBe(false)
  })

  test('Should be valid when every supplied result is valid', () => {
    expect(
      combineValidationResults(
        createValidationResult(),
        createValidationResult()
      ).isValid
    ).toBe(true)
  })
})

describe('#joinPath and #indexPath', () => {
  test('Should join a nested property path', () => {
    expect(joinPath('trip', 'dateStarted')).toBe('trip.dateStarted')
  })

  test('Should return the segment alone when there is no base', () => {
    expect(joinPath('', 'vessel')).toBe('vessel')
  })

  test('Should build an indexed array path', () => {
    expect(indexPath('gear', 0)).toBe('gear[0]')
  })

  test('Should compose joinPath and indexPath for deep paths', () => {
    expect(
      joinPath(joinPath(indexPath('gear', 0), 'speciesCaught'), '')
    ).not.toBeUndefined()
    expect(
      `${indexPath('gear', 0)}.speciesCaught${indexPath('', 1)}.attributes${indexPath('', 0)}.value`
    ).toBe('gear[0].speciesCaught[1].attributes[0].value')
  })
})
