import { normaliseSpeciesNotLanded } from './species-not-landed.js'

describe('#normaliseSpeciesNotLanded', () => {
  test('Should normalise a species entry, dropping every snapshot field', () => {
    const result = normaliseSpeciesNotLanded([
      {
        id: 'WHG',
        name: 'DROP-ME',
        faoCode: 'DROP-ME',
        scientificName: 'DROP-ME',
        isActive: true,
        weightAboveMinimumKg: 6.5,
        weightBelowMinimumKg: null,
        weightLegallyDiscardedKg: null,
        weightPrecision: 'oneDecimalPlace'
      }
    ])

    expect(result).toEqual([
      {
        id: 'WHG',
        weightAboveMinimumKg: 6.5,
        weightBelowMinimumKg: null,
        weightLegallyDiscardedKg: null,
        weightPrecision: 'oneDecimalPlace'
      }
    ])
  })

  test('Should preserve multiple entries independently', () => {
    const result = normaliseSpeciesNotLanded([{ id: 'WHG' }, { id: 'HAD' }])

    expect(result).toHaveLength(2)
    expect(result[0].id).toBe('WHG')
    expect(result[1].id).toBe('HAD')
  })

  test('Should pass through a non-array value unchanged', () => {
    expect(normaliseSpeciesNotLanded('not-an-array')).toBe('not-an-array')
  })

  test('Should pass through a malformed (non-object) entry unchanged', () => {
    expect(normaliseSpeciesNotLanded(['not-an-object', null])).toEqual([
      'not-an-object',
      null
    ])
  })

  test('Should preserve undefined and null', () => {
    expect(normaliseSpeciesNotLanded(undefined)).toBeUndefined()
    expect(normaliseSpeciesNotLanded(null)).toBeNull()
  })

  test('Should not mutate the input', () => {
    const input = Object.freeze([
      Object.freeze({ id: 'WHG', weightAboveMinimumKg: 6.5 })
    ])

    const result = normaliseSpeciesNotLanded(input)

    expect(input[0]).toEqual({ id: 'WHG', weightAboveMinimumKg: 6.5 })
    expect(result[0]).not.toBe(input[0])
  })

  test('Should produce deterministic output for equivalent repeated input', () => {
    const input = [{ id: 'WHG', weightAboveMinimumKg: 6.5 }]

    expect(normaliseSpeciesNotLanded(input)).toEqual(
      normaliseSpeciesNotLanded(JSON.parse(JSON.stringify(input)))
    )
  })
})
