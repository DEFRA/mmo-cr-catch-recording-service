import { validateSpeciesNotLanded } from './species-not-landed.js'

describe('#validateSpeciesNotLanded', () => {
  test('Should accept an absent or non-array value', () => {
    expect(validateSpeciesNotLanded(undefined)).toEqual({
      valid: true,
      issues: []
    })
    expect(validateSpeciesNotLanded(null)).toEqual({ valid: true, issues: [] })
    expect(validateSpeciesNotLanded('not-an-array')).toEqual({
      valid: true,
      issues: []
    })
  })

  test('Should accept an empty array', () => {
    expect(validateSpeciesNotLanded([])).toEqual({ valid: true, issues: [] })
  })

  test('Should accept a well-formed entry', () => {
    const result = validateSpeciesNotLanded([
      {
        id: 'WHG',
        weightAboveMinimumKg: 6.5,
        weightBelowMinimumKg: null,
        weightLegallyDiscardedKg: null,
        weightPrecision: 'oneDecimalPlace'
      }
    ])

    expect(result).toEqual({ valid: true, issues: [] })
  })

  test('Should reject an entry missing an id with REQUIRED', () => {
    const result = validateSpeciesNotLanded([{}])

    expect(result.valid).toBe(false)
    expect(result.issues).toContainEqual({
      code: 'REQUIRED',
      path: 'speciesNotLanded.0.id',
      message: 'A species id is required'
    })
  })

  test('Should reject a non-numeric, non-null weight field with INVALID_STRUCTURE', () => {
    const result = validateSpeciesNotLanded([
      { id: 'WHG', weightAboveMinimumKg: 'lots' }
    ])

    expect(result.valid).toBe(false)
    expect(result.issues).toContainEqual({
      code: 'INVALID_STRUCTURE',
      path: 'speciesNotLanded.0.weightAboveMinimumKg',
      message: 'A weight must be a number or null'
    })
  })

  test('Should reject an unsupported weightPrecision value with UNSUPPORTED_VALUE', () => {
    const result = validateSpeciesNotLanded([
      { id: 'WHG', weightPrecision: 'twoDecimalPlaces' }
    ])

    expect(result.valid).toBe(false)
    expect(result.issues).toContainEqual({
      code: 'UNSUPPORTED_VALUE',
      path: 'speciesNotLanded.0.weightPrecision',
      message: 'Unsupported weight precision'
    })
  })

  test('Should reject a duplicate authoritative species id', () => {
    const result = validateSpeciesNotLanded([{ id: 'WHG' }, { id: 'WHG' }])

    expect(result.valid).toBe(false)
    expect(result.issues).toContainEqual({
      code: 'DUPLICATE_RELATIONSHIP',
      path: 'speciesNotLanded.1.id',
      message: 'This species is already listed as not landed'
    })
  })

  test('Should ignore a malformed (non-object) entry rather than crash', () => {
    expect(validateSpeciesNotLanded(['not-an-object', null]).valid).toBe(true)
  })

  test('Should not mutate the input', () => {
    const input = Object.freeze([Object.freeze({ id: 'WHG' })])

    expect(() => validateSpeciesNotLanded(input)).not.toThrow()
    expect(input[0].id).toBe('WHG')
  })

  test('Should produce deterministic output for equivalent repeated input', () => {
    const input = [{ id: 'WHG' }, { id: 'HAD' }]

    expect(validateSpeciesNotLanded(input)).toEqual(
      validateSpeciesNotLanded(input)
    )
  })
})
