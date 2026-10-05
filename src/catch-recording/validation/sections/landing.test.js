import { readFileSync } from 'node:fs'

import { validateLanding } from './landing.js'

const GEARS = Object.freeze([
  Object.freeze({
    associationId: 'gear-1',
    speciesCaught: Object.freeze([
      Object.freeze({ associationId: 'species-1' })
    ])
  }),
  Object.freeze({
    associationId: 'gear-2',
    speciesCaught: Object.freeze([
      Object.freeze({ associationId: 'species-2' })
    ])
  })
])

describe('#validateLanding', () => {
  test('Should accept a retained-species entry that correctly references gear and species', () => {
    const result = validateLanding(
      {
        retainedSpecies: [
          { gearAssociationId: 'gear-1', speciesAssociationId: 'species-1' }
        ]
      },
      GEARS
    )

    expect(result).toEqual({ valid: true, issues: [] })
  })

  test('Should accept an empty retainedSpecies collection', () => {
    expect(validateLanding({ retainedSpecies: [] }, GEARS)).toEqual({
      valid: true,
      issues: []
    })
  })

  test('Should accept an absent or malformed landing value', () => {
    expect(validateLanding(undefined, GEARS)).toEqual({
      valid: true,
      issues: []
    })
    expect(validateLanding(null, GEARS)).toEqual({ valid: true, issues: [] })
    expect(validateLanding('not-an-object', GEARS)).toEqual({
      valid: true,
      issues: []
    })
  })

  test('Should reject a gearAssociationId that does not exist', () => {
    const result = validateLanding(
      {
        retainedSpecies: [
          {
            gearAssociationId: 'missing-gear',
            speciesAssociationId: 'species-1'
          }
        ]
      },
      GEARS
    )

    expect(result.valid).toBe(false)
    expect(result.issues).toContainEqual({
      code: 'INVALID_REFERENCE',
      path: 'landing.retainedSpecies.0.gearAssociationId',
      message:
        'Does not reference an existing gear association in this Catch Record'
    })
  })

  test('Should reject a speciesAssociationId that exists only under a different gear', () => {
    const result = validateLanding(
      {
        retainedSpecies: [
          { gearAssociationId: 'gear-1', speciesAssociationId: 'species-2' }
        ]
      },
      GEARS
    )

    expect(result.valid).toBe(false)
    expect(result.issues).toContainEqual({
      code: 'INVALID_REFERENCE',
      path: 'landing.retainedSpecies.0.speciesAssociationId',
      message:
        'Does not reference an existing species association under the referenced gear'
    })
  })

  test('Should reject a missing speciesAssociationId', () => {
    const result = validateLanding(
      {
        retainedSpecies: [
          {
            gearAssociationId: 'gear-1',
            speciesAssociationId: 'missing-species'
          }
        ]
      },
      GEARS
    )

    expect(result.valid).toBe(false)
  })

  test('Should handle an absent gears collection safely', () => {
    const result = validateLanding(
      {
        retainedSpecies: [
          { gearAssociationId: 'gear-1', speciesAssociationId: 'species-1' }
        ]
      },
      undefined
    )

    expect(result.valid).toBe(false)
    expect(result.issues).toContainEqual({
      code: 'INVALID_REFERENCE',
      path: 'landing.retainedSpecies.0.gearAssociationId',
      message:
        'Does not reference an existing gear association in this Catch Record'
    })
  })

  test('Should ignore a malformed (non-object) retained-species entry rather than crash', () => {
    expect(
      validateLanding({ retainedSpecies: ['not-an-object', null] }, GEARS)
    ).toEqual({
      valid: true,
      issues: []
    })
  })

  test('Should ignore a malformed (non-object) or empty-associationId gear entry when building the reference map', () => {
    const malformedGears = [
      'not-an-object',
      null,
      { associationId: '   ' },
      {
        associationId: 'gear-1',
        speciesCaught: [{ associationId: 'species-1' }]
      }
    ]

    const result = validateLanding(
      {
        retainedSpecies: [
          { gearAssociationId: 'gear-1', speciesAssociationId: 'species-1' }
        ]
      },
      malformedGears
    )

    expect(result).toEqual({ valid: true, issues: [] })
  })

  test('Should not accept a non-array retainedSpecies value as a reason to fail', () => {
    expect(validateLanding({ retainedSpecies: 'not-an-array' }, GEARS)).toEqual(
      {
        valid: true,
        issues: []
      }
    )
  })

  test('Should not mutate the landing or gears input', () => {
    const landing = Object.freeze({
      retainedSpecies: Object.freeze([
        Object.freeze({
          gearAssociationId: 'gear-1',
          speciesAssociationId: 'species-1'
        })
      ])
    })

    expect(() => validateLanding(landing, GEARS)).not.toThrow()
    expect(landing.retainedSpecies[0].gearAssociationId).toBe('gear-1')
    expect(GEARS[0].associationId).toBe('gear-1')
  })

  test('Should produce deterministic output for equivalent repeated input', () => {
    const landing = {
      retainedSpecies: [
        { gearAssociationId: 'gear-1', speciesAssociationId: 'species-1' }
      ]
    }

    expect(validateLanding(landing, GEARS)).toEqual(
      validateLanding(landing, GEARS)
    )
  })

  test('Should not import Hapi, Boom, Joi, or MongoDB', () => {
    const source = readFileSync(
      new URL('./landing.js', import.meta.url),
      'utf8'
    )

    expect(source).not.toMatch(/from\s+['"]@hapi\/hapi['"]/)
    expect(source).not.toMatch(/from\s+['"]@hapi\/boom['"]/)
    expect(source).not.toMatch(/from\s+['"]joi['"]/)
    expect(source).not.toMatch(/from\s+['"]mongodb['"]/)
  })
})
