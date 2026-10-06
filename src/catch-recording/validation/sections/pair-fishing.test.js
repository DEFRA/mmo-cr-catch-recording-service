import { readFileSync } from 'node:fs'

import { validatePairFishing } from './pair-fishing.js'

describe('#validatePairFishing', () => {
  test('Should accept the disabled baseline', () => {
    expect(
      validatePairFishing({
        enabled: false,
        pairVessel: null,
        pairSkipperName: null
      })
    ).toEqual({ valid: true, issues: [] })
  })

  test('Should accept disabled with both fields absent', () => {
    expect(validatePairFishing({ enabled: false })).toEqual({
      valid: true,
      issues: []
    })
  })

  test('Should reject a populated pairVessel when disabled', () => {
    const result = validatePairFishing({
      enabled: false,
      pairVessel: { id: 'abc' }
    })

    expect(result.valid).toBe(false)
    expect(result.issues).toContainEqual({
      code: 'CONDITIONAL_FIELD_INCONSISTENT',
      path: 'pairFishing.pairVessel',
      message: 'Must be null or absent when pair fishing is disabled'
    })
  })

  test('Should reject a populated pairSkipperName when disabled', () => {
    const result = validatePairFishing({
      enabled: false,
      pairSkipperName: 'Jane Doe'
    })

    expect(result.valid).toBe(false)
    expect(result.issues).toContainEqual({
      code: 'CONDITIONAL_FIELD_INCONSISTENT',
      path: 'pairFishing.pairSkipperName',
      message: 'Must be null or absent when pair fishing is disabled'
    })
  })

  test('Should require pairVessel and pairSkipperName when enabled is true (Step 21 resolution)', () => {
    expect(validatePairFishing({ enabled: true })).toMatchObject({
      valid: false,
      issues: [
        {
          code: 'REQUIRED',
          path: 'pairFishing.pairVessel',
          message: 'Required when pair fishing is enabled'
        },
        {
          code: 'REQUIRED',
          path: 'pairFishing.pairSkipperName',
          message: 'Required when pair fishing is enabled'
        }
      ]
    })

    expect(
      validatePairFishing({ enabled: true, pairSkipperName: 'Jane Doe' })
    ).toMatchObject({
      valid: false,
      issues: [
        {
          code: 'REQUIRED',
          path: 'pairFishing.pairVessel'
        }
      ]
    })

    expect(
      validatePairFishing({
        enabled: true,
        pairVessel: 'Other Vessel',
        pairSkipperName: 'Jane Doe'
      })
    ).toEqual({ valid: true, issues: [] })

    expect(
      validatePairFishing({
        enabled: true,
        pairVessel: '  ',
        pairSkipperName: ''
      })
    ).toMatchObject({ valid: false })
  })

  test('Should accept an absent or malformed pairFishing value', () => {
    expect(validatePairFishing(undefined)).toEqual({ valid: true, issues: [] })
    expect(validatePairFishing(null)).toEqual({ valid: true, issues: [] })
    expect(validatePairFishing('not-an-object')).toEqual({
      valid: true,
      issues: []
    })
  })

  test('Should not mutate the input', () => {
    const input = Object.freeze({
      enabled: false,
      pairVessel: Object.freeze({ id: 'abc' })
    })

    expect(() => validatePairFishing(input)).not.toThrow()
    expect(input.pairVessel).toEqual({ id: 'abc' })
  })

  test('Should not import Hapi, Boom, Joi, or MongoDB', () => {
    const source = readFileSync(
      new URL('./pair-fishing.js', import.meta.url),
      'utf8'
    )

    expect(source).not.toMatch(/from\s+['"]@hapi\/hapi['"]/)
    expect(source).not.toMatch(/from\s+['"]@hapi\/boom['"]/)
    expect(source).not.toMatch(/from\s+['"]joi['"]/)
    expect(source).not.toMatch(/from\s+['"]mongodb['"]/)
  })
})
