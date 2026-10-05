import { readFileSync } from 'node:fs'

import { normaliseLanding } from './landing.js'

describe('#normaliseLanding', () => {
  test('Should normalise a complete landing section', () => {
    expect(
      normaliseLanding({
        intention: 'NOT_LANDING',
        retainedSpecies: [
          {
            gearAssociationId: 'gear-assoc-1',
            speciesAssociationId: 'species-assoc-1',
            species: { id: 'species-1', faoCodeSnapshot: 'DROP-ME' },
            details: [{ attributeId: 'LSC', value: 5, unitSnapshot: 'kg' }]
          }
        ],
        notLandingDetails: null
      })
    ).toEqual({
      intention: 'NOT_LANDING',
      retainedSpecies: [
        {
          gearAssociationId: 'gear-assoc-1',
          speciesAssociationId: 'species-assoc-1',
          details: [{ attributeId: 'LSC', value: 5, unitSnapshot: 'kg' }]
        }
      ],
      notLandingDetails: null
    })
  })

  test('Should preserve intention exactly as supplied, never inferring or defaulting it', () => {
    expect(normaliseLanding({ intention: null })).toEqual({ intention: null })
    expect(normaliseLanding({ intention: 'ANYTHING_THE_CLIENT_SENT' })).toEqual(
      {
        intention: 'ANYTHING_THE_CLIENT_SENT'
      }
    )
  })

  test('Should not repair the known NOT_LANDING + populated retainedSpecies inconsistency', () => {
    const result = normaliseLanding({
      intention: 'NOT_LANDING',
      retainedSpecies: [{ gearAssociationId: 'g1', speciesAssociationId: 's1' }]
    })

    expect(result.intention).toBe('NOT_LANDING')
    expect(result.retainedSpecies).toHaveLength(1)
  })

  test('Should drop the species display snapshot from a retained-species entry', () => {
    const result = normaliseLanding({
      retainedSpecies: [
        {
          gearAssociationId: 'g1',
          speciesAssociationId: 's1',
          species: { id: 'species-1', faoCodeSnapshot: 'COD' }
        }
      ]
    })

    expect(result.retainedSpecies[0]).not.toHaveProperty('species')
  })

  test('Should drop an unknown field', () => {
    expect(normaliseLanding({ intention: null, unexpected: 'value' })).toEqual({
      intention: null
    })
  })

  test('Should preserve undefined and null for the whole section', () => {
    expect(normaliseLanding(undefined)).toBeUndefined()
    expect(normaliseLanding(null)).toBeNull()
  })

  test('Should pass through a non-array retainedSpecies value unchanged', () => {
    expect(normaliseLanding({ retainedSpecies: 'not-an-array' })).toEqual({
      retainedSpecies: 'not-an-array'
    })
  })

  test('Should pass through a malformed (non-object) landing payload unchanged', () => {
    expect(normaliseLanding('not-an-object')).toBe('not-an-object')
    expect(normaliseLanding(['array'])).toEqual(['array'])
  })

  test('Should pass through malformed (non-object) nested retained-species entries and catch details', () => {
    const result = normaliseLanding({
      retainedSpecies: [
        'not-an-object',
        null,
        {
          gearAssociationId: 'g1',
          speciesAssociationId: 's1',
          details: ['not-an-object', null]
        }
      ]
    })

    expect(result.retainedSpecies[0]).toBe('not-an-object')
    expect(result.retainedSpecies[1]).toBeNull()
    expect(result.retainedSpecies[2].details).toEqual(['not-an-object', null])
  })

  test('Should not mutate the input', () => {
    const input = Object.freeze({
      intention: 'NOT_LANDING',
      retainedSpecies: Object.freeze([
        Object.freeze({ gearAssociationId: 'g1', speciesAssociationId: 's1' })
      ])
    })

    const result = normaliseLanding(input)

    expect(input.retainedSpecies[0]).toEqual({
      gearAssociationId: 'g1',
      speciesAssociationId: 's1'
    })
    expect(result.retainedSpecies).not.toBe(input.retainedSpecies)
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
