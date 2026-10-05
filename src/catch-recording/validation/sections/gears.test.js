import { readFileSync } from 'node:fs'

import { validateGears } from './gears.js'

function buildGear(overrides = {}) {
  return {
    associationId: 'gear-assoc-1',
    gear: { id: 'gear-1' },
    speciesCaught: [
      { associationId: 'species-assoc-1', species: { id: 'species-1' } }
    ],
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

  test('Should reject duplicate species-association IDs within the same gear', () => {
    const result = validateGears([
      buildGear({
        associationId: 'gear-1',
        speciesCaught: [
          { associationId: 'species-1', species: { id: 'cod' } },
          { associationId: 'species-1', species: { id: 'haddock' } }
        ]
      })
    ])

    expect(result.valid).toBe(false)
    expect(result.issues).toContainEqual({
      code: 'DUPLICATE_RELATIONSHIP',
      path: 'gears.0.speciesCaught.1.associationId',
      message: 'Duplicate species association within this gear'
    })
  })

  test('Should allow the same species-association ID to appear under different gears', () => {
    const result = validateGears([
      buildGear({
        associationId: 'gear-1',
        speciesCaught: [{ associationId: 'species-1' }]
      }),
      buildGear({
        associationId: 'gear-2',
        speciesCaught: [{ associationId: 'species-1' }]
      })
    ])

    expect(result).toEqual({ valid: true, issues: [] })
  })

  test('Should allow the same authoritative species under different gears', () => {
    const result = validateGears([
      buildGear({
        associationId: 'gear-1',
        speciesCaught: [
          { associationId: 'species-assoc-1', species: { id: 'cod' } }
        ]
      }),
      buildGear({
        associationId: 'gear-2',
        speciesCaught: [
          { associationId: 'species-assoc-2', species: { id: 'cod' } }
        ]
      })
    ])

    expect(result).toEqual({ valid: true, issues: [] })
  })

  test('Should ignore a malformed (non-object) gear entry rather than crash', () => {
    expect(validateGears(['not-an-object', null]).valid).toBe(true)
  })

  test('Should ignore a malformed (non-object) species-association entry rather than crash', () => {
    expect(
      validateGears([
        buildGear({
          associationId: 'gear-1',
          speciesCaught: ['not-an-object', null]
        })
      ]).valid
    ).toBe(true)
  })

  test('Should not flag a gear with no associationId (handled by structural validation)', () => {
    expect(validateGears([{ gear: { id: 'gear-1' } }]).valid).toBe(true)
  })

  test('Should not flag a species association with no associationId (handled by structural validation)', () => {
    expect(
      validateGears([
        buildGear({ speciesCaught: [{ species: { id: 'cod' } }] })
      ]).valid
    ).toBe(true)
  })

  test('Should not mutate the input', () => {
    const input = Object.freeze([
      Object.freeze(buildGear({ associationId: 'gear-1' })),
      Object.freeze(
        buildGear({ associationId: 'gear-1', speciesCaught: Object.freeze([]) })
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
