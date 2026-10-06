import { readFileSync } from 'node:fs'

import { normaliseGears } from './gears.js'

function buildGear(overrides = {}) {
  return {
    associationId: 'gear-assoc-1',
    gear: { id: 'gear-1', codeSnapshot: 'DROP-ME', nameSnapshot: 'DROP-ME' },
    characteristics: [
      {
        characteristicId: 'number-of-times-gear-shot',
        nameSnapshot: 'DROP-ME',
        value: 2
      },
      { characteristicId: 'mesh-size', value: 9, unitSnapshot: '  mm  ' }
    ],
    statisticalArea: { id: 'area-1', codeSnapshot: 'DROP-ME' },
    speciesCaught: [
      {
        id: 'species-1',
        name: 'DROP-ME',
        faoCode: 'DROP-ME',
        isActive: true,
        weightAboveMinimumKg: 120.5,
        weightBelowMinimumKg: 4,
        weightLegallyDiscardedKg: null,
        weightPrecision: '  oneDecimalPlace  '
      }
    ],
    ...overrides
  }
}

describe('#normaliseGears', () => {
  test('Should normalise a complete gear, dropping every snapshot field', () => {
    const [gear] = normaliseGears([buildGear()])

    expect(gear).toEqual({
      associationId: 'gear-assoc-1',
      gear: { id: 'gear-1' },
      characteristics: [
        { characteristicId: 'number-of-times-gear-shot', value: 2 },
        { characteristicId: 'mesh-size', value: 9, unitSnapshot: 'mm' }
      ],
      statisticalArea: { id: 'area-1' },
      speciesCaught: [
        {
          id: 'species-1',
          weightAboveMinimumKg: 120.5,
          weightBelowMinimumKg: 4,
          weightLegallyDiscardedKg: null,
          weightPrecision: 'oneDecimalPlace'
        }
      ]
    })
  })

  test('Should preserve multiple gear associations independently', () => {
    const result = normaliseGears([
      buildGear({ associationId: 'gear-assoc-1' }),
      buildGear({ associationId: 'gear-assoc-2', gear: { id: 'gear-2' } })
    ])

    expect(result).toHaveLength(2)
    expect(result[0].associationId).toBe('gear-assoc-1')
    expect(result[1].associationId).toBe('gear-assoc-2')
    expect(result[1].gear).toEqual({ id: 'gear-2' })
  })

  test('Should preserve the same species independently under different gears', () => {
    const result = normaliseGears([
      buildGear({ associationId: 'gear-assoc-1' }),
      buildGear({
        associationId: 'gear-assoc-2',
        speciesCaught: [
          {
            id: 'species-1', // same authoritative species id as gear-assoc-1
            weightAboveMinimumKg: 10
          }
        ]
      })
    ])

    expect(result[0].speciesCaught[0].id).toBe('species-1')
    expect(result[1].speciesCaught[0].id).toBe('species-1')
    expect(result[0].speciesCaught[0].weightAboveMinimumKg).toBe(120.5)
    expect(result[1].speciesCaught[0].weightAboveMinimumKg).toBe(10)
  })

  test('Should preserve a value of any approved type without coercion', () => {
    const [gear] = normaliseGears([
      buildGear({
        characteristics: [{ characteristicId: 'c1', value: 'string-value' }]
      })
    ])

    expect(gear.characteristics[0].value).toBe('string-value')
  })

  test('Should never produce a root-level statistical area or species collection', () => {
    const result = normaliseGears([buildGear()])

    expect(result).not.toHaveProperty('statisticalArea')
    expect(result).not.toHaveProperty('speciesCaught')
  })

  test('Should drop unknown fields at every nesting level', () => {
    const [gear] = normaliseGears([
      buildGear({
        unexpectedGearField: 'drop-me',
        characteristics: [
          { characteristicId: 'c1', value: 1, unexpectedField: 'drop-me' }
        ]
      })
    ])

    expect(gear).not.toHaveProperty('unexpectedGearField')
    expect(gear.characteristics[0]).not.toHaveProperty('unexpectedField')
  })

  test('Should drop a client-supplied full species reference object, keeping only approved fields', () => {
    const [gear] = normaliseGears([
      buildGear({
        speciesCaught: [
          {
            id: 'species-1',
            name: 'Atlantic cod (COD)',
            faoCode: 'COD',
            scientificName: 'Gadus morhua',
            commonNames: [
              { id: '1', countryCode: 'GBR', name: 'Atlantic cod' }
            ],
            localNames: [],
            isActive: true,
            weightAboveMinimumKg: 120.5
          }
        ]
      })
    ])

    expect(gear.speciesCaught[0]).toEqual({
      id: 'species-1',
      weightAboveMinimumKg: 120.5
    })
  })

  test('Should pass through a non-array gears value unchanged', () => {
    expect(normaliseGears('not-an-array')).toBe('not-an-array')
  })

  test('Should pass through a malformed (non-object) gear association unchanged', () => {
    expect(normaliseGears(['not-an-object', null])).toEqual([
      'not-an-object',
      null
    ])
  })

  test('Should pass through malformed (non-object) nested entries unchanged', () => {
    const [gear] = normaliseGears([
      buildGear({
        characteristics: ['not-an-object', null],
        speciesCaught: ['not-an-object', null, { id: 'species-1' }]
      })
    ])

    expect(gear.characteristics).toEqual(['not-an-object', null])
    expect(gear.speciesCaught[0]).toBe('not-an-object')
    expect(gear.speciesCaught[1]).toBeNull()
    expect(gear.speciesCaught[2]).toEqual({ id: 'species-1' })
  })

  test('Should preserve undefined and null', () => {
    expect(normaliseGears(undefined)).toBeUndefined()
    expect(normaliseGears(null)).toBeNull()
  })

  test('Should not mutate the input at any nesting level', () => {
    const input = Object.freeze([
      Object.freeze({
        ...buildGear(),
        characteristics: Object.freeze(
          buildGear().characteristics.map((c) => Object.freeze(c))
        )
      })
    ])

    const result = normaliseGears(input)

    expect(input[0].characteristics[0]).toEqual({
      characteristicId: 'number-of-times-gear-shot',
      nameSnapshot: 'DROP-ME',
      value: 2
    })
    expect(result[0]).not.toBe(input[0])
    expect(result[0].characteristics).not.toBe(input[0].characteristics)
  })

  test('Should produce deterministic output for equivalent repeated input', () => {
    const input = [buildGear()]

    expect(normaliseGears(input)).toEqual(
      normaliseGears(JSON.parse(JSON.stringify(input)))
    )
  })

  test('Should not import Hapi, Boom, Joi, or MongoDB', () => {
    const source = readFileSync(new URL('./gears.js', import.meta.url), 'utf8')

    expect(source).not.toMatch(/from\s+['"]@hapi\/hapi['"]/)
    expect(source).not.toMatch(/from\s+['"]@hapi\/boom['"]/)
    expect(source).not.toMatch(/from\s+['"]joi['"]/)
    expect(source).not.toMatch(/from\s+['"]mongodb['"]/)
  })
})
