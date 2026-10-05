import { readFileSync } from 'node:fs'

import { normaliseVesselSelection } from './vessel.js'

describe('#normaliseVesselSelection', () => {
  test('Should keep only the stable id, trimmed', () => {
    expect(normaliseVesselSelection({ id: '  0fe4d4aa-22f8  ' })).toEqual({
      id: '0fe4d4aa-22f8'
    })
  })

  test('Should drop client-supplied snapshot fields', () => {
    expect(
      normaliseVesselSelection({
        id: '0fe4d4aa-22f8',
        rssSnapshot: 'RSS123456',
        nameSnapshot: 'EXAMPLE VESSEL',
        externalMarkSnapshot: 'PH123',
        lengthOverallMetresSnapshot: 8.74
      })
    ).toEqual({ id: '0fe4d4aa-22f8' })
  })

  test('Should drop an unknown field', () => {
    expect(
      normaliseVesselSelection({ id: 'abc', unexpected: 'value' })
    ).toEqual({ id: 'abc' })
  })

  test('Should preserve undefined and null', () => {
    expect(normaliseVesselSelection(undefined)).toBeUndefined()
    expect(normaliseVesselSelection(null)).toBeNull()
  })

  test('Should not mutate the input', () => {
    const input = Object.freeze({
      id: '  abc  ',
      nameSnapshot: 'Should be dropped'
    })
    const result = normaliseVesselSelection(input)

    expect(input).toEqual({ id: '  abc  ', nameSnapshot: 'Should be dropped' })
    expect(result).toEqual({ id: 'abc' })
  })

  test('Should produce equivalent output for repeated calls (determinism)', () => {
    const input = { id: 'abc' }

    expect(normaliseVesselSelection(input)).toEqual(
      normaliseVesselSelection(input)
    )
  })

  test('Should not import Hapi, Boom, Joi, or MongoDB', () => {
    const source = readFileSync(new URL('./vessel.js', import.meta.url), 'utf8')

    expect(source).not.toMatch(/from\s+['"]@hapi\/hapi['"]/)
    expect(source).not.toMatch(/from\s+['"]@hapi\/boom['"]/)
    expect(source).not.toMatch(/from\s+['"]joi['"]/)
    expect(source).not.toMatch(/from\s+['"]mongodb['"]/)
  })
})
