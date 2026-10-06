import { readFileSync } from 'node:fs'

import { validateGears } from './gears.js'

function buildGear(overrides = {}) {
  return {
    associationId: 'gear-assoc-1',
    gear: { id: 'gear-1' },
    speciesCaught: [{ id: 'species-1' }],
    ...overrides
  }
}

describe('#validateGears', () => {
  test('Should accept a single well-formed gear', () => {
    expect(validateGears([buildGear()])).toEqual({ valid: true, issues: [] })
  })

  test('Should accept an absent or non-array value', () => {
    expect(validateGears(undefined)).toEqual({ valid: true, issues: [] })
    expect(validateGears(null)).toEqual({ valid: true, issues: [] })
    expect(validateGears('not-an-array')).toEqual({ valid: true, issues: [] })
  })

  test('Should reject duplicate gear-association IDs', () => {
    const result = validateGears([
      buildGear({ associationId: 'gear-1' }),
      buildGear({ associationId: 'gear-1', speciesCaught: [] })
    ])

    expect(result.valid).toBe(false)
    expect(result.issues).toContainEqual({
      code: 'DUPLICATE_RELATIONSHIP',
      path: 'gears.1.associationId',
      message: 'Duplicate gear association'
    })
  })

  test('Should allow the same authoritative species under different gears', () => {
    const result = validateGears([
      buildGear({ associationId: 'gear-1', speciesCaught: [{ id: 'cod' }] }),
      buildGear({ associationId: 'gear-2', speciesCaught: [{ id: 'cod' }] })
    ])

    expect(result).toEqual({ valid: true, issues: [] })
  })

  test('Should ignore a malformed (non-object) gear entry rather than crash', () => {
    expect(validateGears(['not-an-object', null]).valid).toBe(true)
  })

  test('Should ignore a malformed (non-object) species entry rather than crash', () => {
    expect(
      validateGears([
        buildGear({
          associationId: 'gear-1',
          speciesCaught: ['not-an-object', null]
        })
      ]).valid
    ).toBe(true)
  })

  test('Should reject a gear association missing a gear.id with REQUIRED', () => {
    const result = validateGears([buildGear({ gear: {} })])

    expect(result.valid).toBe(false)
    expect(result.issues).toContainEqual({
      code: 'REQUIRED',
      path: 'gears.0.gear.id',
      message: 'A gear id is required'
    })
  })

  test('Should reject a gear association with an empty-string gear.id with REQUIRED', () => {
    const result = validateGears([buildGear({ gear: { id: '   ' } })])

    expect(result.valid).toBe(false)
    expect(result.issues).toContainEqual({
      code: 'REQUIRED',
      path: 'gears.0.gear.id',
      message: 'A gear id is required'
    })
  })

  test('Should reject a gear association with an entirely missing gear with REQUIRED', () => {
    const result = validateGears([buildGear({ gear: undefined })])

    expect(result.valid).toBe(false)
    expect(result.issues).toContainEqual({
      code: 'REQUIRED',
      path: 'gears.0.gear.id',
      message: 'A gear id is required'
    })
  })

  test('Should reject a malformed (non-object) gear selection with INVALID_STRUCTURE', () => {
    const result = validateGears([buildGear({ gear: 'not-an-object' })])

    expect(result.valid).toBe(false)
    expect(result.issues).toContainEqual({
      code: 'INVALID_STRUCTURE',
      path: 'gears.0.gear',
      message: 'The gear selection must be an object'
    })
  })

  test('Should reject an array-valued gear selection with INVALID_STRUCTURE', () => {
    const result = validateGears([buildGear({ gear: ['gear-1'] })])

    expect(result.valid).toBe(false)
    expect(result.issues).toContainEqual({
      code: 'INVALID_STRUCTURE',
      path: 'gears.0.gear',
      message: 'The gear selection must be an object'
    })
  })

  test('Step 24: Should accept an absent statisticalArea key', () => {
    const result = validateGears([buildGear()])

    expect(result.valid).toBe(true)
  })

  test('Step 24: Should accept an explicit null statisticalArea', () => {
    const result = validateGears([buildGear({ statisticalArea: null })])

    expect(result.valid).toBe(true)
  })

  test('Step 24: Should accept a well-formed statisticalArea', () => {
    const result = validateGears([
      buildGear({ statisticalArea: { id: 'area-1' } })
    ])

    expect(result.valid).toBe(true)
  })

  test('Step 24: Should reject a statisticalArea missing an id with REQUIRED', () => {
    const result = validateGears([buildGear({ statisticalArea: {} })])

    expect(result.valid).toBe(false)
    expect(result.issues).toContainEqual({
      code: 'REQUIRED',
      path: 'gears.0.statisticalArea.id',
      message: 'A statistical area id is required'
    })
  })

  test('Step 24: Should reject a statisticalArea with an empty-string id with REQUIRED', () => {
    const result = validateGears([
      buildGear({ statisticalArea: { id: '   ' } })
    ])

    expect(result.valid).toBe(false)
    expect(result.issues).toContainEqual({
      code: 'REQUIRED',
      path: 'gears.0.statisticalArea.id',
      message: 'A statistical area id is required'
    })
  })

  test('Step 24: Should reject a malformed (non-object) statisticalArea with INVALID_STRUCTURE', () => {
    const result = validateGears([
      buildGear({ statisticalArea: 'not-an-object' })
    ])

    expect(result.valid).toBe(false)
    expect(result.issues).toContainEqual({
      code: 'INVALID_STRUCTURE',
      path: 'gears.0.statisticalArea',
      message: 'The statistical area selection must be an object'
    })
  })

  test('Step 24: Should reject an array-valued statisticalArea with INVALID_STRUCTURE', () => {
    const result = validateGears([buildGear({ statisticalArea: ['area-1'] })])

    expect(result.valid).toBe(false)
    expect(result.issues).toContainEqual({
      code: 'INVALID_STRUCTURE',
      path: 'gears.0.statisticalArea',
      message: 'The statistical area selection must be an object'
    })
  })

  test('Step 27: Should accept an absent speciesCaught key', () => {
    const result = validateGears([
      { associationId: 'gear-assoc-1', gear: { id: 'gear-1' } }
    ])

    expect(result.valid).toBe(true)
  })

  test('Step 27: Should accept an explicit null speciesCaught', () => {
    const result = validateGears([buildGear({ speciesCaught: null })])

    expect(result.valid).toBe(true)
  })

  test('Step 27: Should accept an empty speciesCaught array', () => {
    const result = validateGears([buildGear({ speciesCaught: [] })])

    expect(result.valid).toBe(true)
  })

  test('Step 27: Should reject a malformed (non-array, non-null) speciesCaught with INVALID_STRUCTURE', () => {
    const result = validateGears([buildGear({ speciesCaught: 'not-an-array' })])

    expect(result.valid).toBe(false)
    expect(result.issues).toContainEqual({
      code: 'INVALID_STRUCTURE',
      path: 'gears.0.speciesCaught',
      message: 'The species-caught collection must be an array'
    })
  })

  test('Step 27: Should reject a species entry missing an id with REQUIRED', () => {
    const result = validateGears([buildGear({ speciesCaught: [{}] })])

    expect(result.valid).toBe(false)
    expect(result.issues).toContainEqual({
      code: 'REQUIRED',
      path: 'gears.0.speciesCaught.0.id',
      message: 'A species id is required'
    })
  })

  test('Step 27: Should accept a species entry with weight fields and weightPrecision', () => {
    const result = validateGears([
      buildGear({
        speciesCaught: [
          {
            id: 'species-1',
            weightAboveMinimumKg: 120.5,
            weightBelowMinimumKg: null,
            weightLegallyDiscardedKg: null,
            weightPrecision: 'oneDecimalPlace'
          }
        ]
      })
    ])

    expect(result).toEqual({ valid: true, issues: [] })
  })

  test('Step 27: Should reject a non-numeric, non-null weight field with INVALID_STRUCTURE', () => {
    const result = validateGears([
      buildGear({
        speciesCaught: [{ id: 'species-1', weightAboveMinimumKg: 'lots' }]
      })
    ])

    expect(result.valid).toBe(false)
    expect(result.issues).toContainEqual({
      code: 'INVALID_STRUCTURE',
      path: 'gears.0.speciesCaught.0.weightAboveMinimumKg',
      message: 'A weight must be a number or null'
    })
  })

  test('Step 27: Should accept a null weight field', () => {
    const result = validateGears([
      buildGear({
        speciesCaught: [{ id: 'species-1', weightAboveMinimumKg: null }]
      })
    ])

    expect(result.valid).toBe(true)
  })

  test('Step 27: Should reject an unsupported weightPrecision value with UNSUPPORTED_VALUE', () => {
    const result = validateGears([
      buildGear({
        speciesCaught: [
          { id: 'species-1', weightPrecision: 'twoDecimalPlaces' }
        ]
      })
    ])

    expect(result.valid).toBe(false)
    expect(result.issues).toContainEqual({
      code: 'UNSUPPORTED_VALUE',
      path: 'gears.0.speciesCaught.0.weightPrecision',
      message: 'Unsupported weight precision'
    })
  })

  test('Step 27: Should accept each approved weightPrecision value', () => {
    for (const weightPrecision of ['wholeNumber', 'oneDecimalPlace']) {
      const result = validateGears([
        buildGear({ speciesCaught: [{ id: 'species-1', weightPrecision }] })
      ])

      expect(result.valid).toBe(true)
    }
  })

  test('Step 27: Should reject the same authoritative species selected twice beneath one gear', () => {
    const result = validateGears([
      buildGear({ speciesCaught: [{ id: 'species-1' }, { id: 'species-1' }] })
    ])

    expect(result.valid).toBe(false)
    expect(result.issues).toContainEqual({
      code: 'DUPLICATE_RELATIONSHIP',
      path: 'gears.0.speciesCaught.1.id',
      message: 'This species is already selected under this gear'
    })
  })

  test('Step 27: Should allow the same authoritative species beneath different gears without flagging a duplicate', () => {
    const result = validateGears([
      buildGear({
        associationId: 'gear-1',
        speciesCaught: [{ id: 'species-1' }]
      }),
      buildGear({
        associationId: 'gear-2',
        speciesCaught: [{ id: 'species-1' }]
      })
    ])

    expect(result.valid).toBe(true)
  })

  test('Should reject a characteristic missing a characteristicId with REQUIRED', () => {
    const result = validateGears([
      buildGear({ characteristics: [{ value: 80 }] })
    ])

    expect(result.valid).toBe(false)
    expect(result.issues).toContainEqual({
      code: 'REQUIRED',
      path: 'gears.0.characteristics.0.characteristicId',
      message: 'A characteristic id is required'
    })
  })

  test('Should reject a characteristic with an empty-string characteristicId with REQUIRED', () => {
    const result = validateGears([
      buildGear({ characteristics: [{ characteristicId: '', value: 80 }] })
    ])

    expect(result.valid).toBe(false)
    expect(result.issues).toContainEqual({
      code: 'REQUIRED',
      path: 'gears.0.characteristics.0.characteristicId',
      message: 'A characteristic id is required'
    })
  })

  test('Should accept a well-formed characteristic alongside a well-formed gear', () => {
    const result = validateGears([
      buildGear({
        characteristics: [{ characteristicId: 'char-1', value: 80 }]
      })
    ])

    expect(result).toEqual({ valid: true, issues: [] })
  })

  test('Should ignore a malformed (non-object) characteristic entry rather than crash', () => {
    expect(
      validateGears([buildGear({ characteristics: ['not-an-object', null] })])
        .valid
    ).toBe(true)
  })

  test('Should still detect duplicate gear-association IDs alongside a required-field failure', () => {
    const result = validateGears([
      buildGear({ associationId: 'gear-1', gear: {} }),
      buildGear({ associationId: 'gear-1', speciesCaught: [] })
    ])

    expect(result.valid).toBe(false)
    expect(result.issues).toContainEqual({
      code: 'DUPLICATE_RELATIONSHIP',
      path: 'gears.1.associationId',
      message: 'Duplicate gear association'
    })
    expect(result.issues).toContainEqual({
      code: 'REQUIRED',
      path: 'gears.0.gear.id',
      message: 'A gear id is required'
    })
  })

  test('Should not flag a gear with no associationId (handled by structural validation)', () => {
    expect(validateGears([{ gear: { id: 'gear-1' } }]).valid).toBe(true)
  })

  test('Should not mutate the input', () => {
    const input = Object.freeze([
      Object.freeze(buildGear({ associationId: 'gear-1' })),
      Object.freeze(
        buildGear({
          associationId: 'gear-1',
          speciesCaught: Object.freeze([])
        })
      )
    ])

    expect(() => validateGears(input)).not.toThrow()
    expect(input[0].associationId).toBe('gear-1')
  })

  test('Should produce deterministic output for equivalent repeated input', () => {
    const input = [
      buildGear({ associationId: 'gear-1' }),
      buildGear({ associationId: 'gear-1' })
    ]

    expect(validateGears(input)).toEqual(validateGears(input))
  })

  test('Should not import Hapi, Boom, Joi, or MongoDB', () => {
    const source = readFileSync(new URL('./gears.js', import.meta.url), 'utf8')

    expect(source).not.toMatch(/from\s+['"]@hapi\/hapi['"]/)
    expect(source).not.toMatch(/from\s+['"]@hapi\/boom['"]/)
    expect(source).not.toMatch(/from\s+['"]joi['"]/)
    expect(source).not.toMatch(/from\s+['"]mongodb['"]/)
  })
})
