import { readFileSync } from 'node:fs'

import { normalisePairFishing } from './pair-fishing.js'

describe('#normalisePairFishing', () => {
  test('Should normalise the disabled baseline', () => {
    expect(
      normalisePairFishing({
        enabled: false,
        pairVessel: null,
        pairSkipperName: null
      })
    ).toEqual({
      enabled: false,
      pairVessel: null,
      pairSkipperName: null
    })
  })

  test('Should trim a populated pairSkipperName string', () => {
    expect(
      normalisePairFishing({ enabled: true, pairSkipperName: '  Jane Doe  ' })
    ).toEqual({
      enabled: true,
      pairSkipperName: 'Jane Doe'
    })
  })

  test('Should preserve a non-string pairVessel value unchanged (shape unresolved)', () => {
    expect(
      normalisePairFishing({ enabled: true, pairVessel: { id: 'abc' } })
    ).toEqual({
      enabled: true,
      pairVessel: { id: 'abc' }
    })
  })

  test('Should not enable pair fishing or infer values that were not supplied', () => {
    expect(normalisePairFishing({ pairSkipperName: 'Jane Doe' })).toEqual({
      pairSkipperName: 'Jane Doe'
    })
  })

  test('Should drop an unknown field', () => {
    expect(
      normalisePairFishing({ enabled: false, unexpected: 'value' })
    ).toEqual({ enabled: false })
  })

  test('Should pass through a malformed (non-object) value unchanged', () => {
    expect(normalisePairFishing('not-an-object')).toBe('not-an-object')
    expect(normalisePairFishing(['array'])).toEqual(['array'])
  })

  test('Should preserve undefined and null for the whole section', () => {
    expect(normalisePairFishing(undefined)).toBeUndefined()
    expect(normalisePairFishing(null)).toBeNull()
  })

  test('Should not mutate the input', () => {
    const input = Object.freeze({ enabled: true, pairSkipperName: '  Jane  ' })
    const result = normalisePairFishing(input)

    expect(input).toEqual({ enabled: true, pairSkipperName: '  Jane  ' })
    expect(result).toEqual({ enabled: true, pairSkipperName: 'Jane' })
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
