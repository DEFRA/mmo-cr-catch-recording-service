import { readFileSync } from 'node:fs'

import {
  copyField,
  normaliseArray,
  normaliseReferenceSelection
} from './object-helpers.js'

describe('#copyField', () => {
  test('Should copy a present key, applying the transform', () => {
    const target = {}
    copyField(target, { id: '  abc  ' }, 'id', (value) => value.trim())

    expect(target).toEqual({ id: 'abc' })
  })

  test('Should preserve an explicit null value', () => {
    const target = {}
    copyField(target, { id: null }, 'id')

    expect(target).toEqual({ id: null })
  })

  test('Should preserve an explicit undefined value distinctly from absence', () => {
    const target = {}
    copyField(target, { id: undefined }, 'id')

    expect(Object.hasOwn(target, 'id')).toBe(true)
    expect(target.id).toBeUndefined()
  })

  test('Should omit a key that is genuinely absent from source', () => {
    const target = {}
    copyField(target, {}, 'id')

    expect(Object.hasOwn(target, 'id')).toBe(false)
  })

  test('Should not copy from a non-object source', () => {
    const target = {}
    copyField(target, null, 'id')
    copyField(target, undefined, 'id')
    copyField(target, 'string', 'id')

    expect(target).toEqual({})
  })

  test('Should not copy an inherited (prototype-chain) property', () => {
    const source = Object.create({ id: 'inherited' })
    const target = {}
    copyField(target, source, 'id')

    expect(Object.hasOwn(target, 'id')).toBe(false)
  })
})

describe('#normaliseReferenceSelection', () => {
  test('Should keep only the stable id, trimmed', () => {
    expect(normaliseReferenceSelection({ id: '  abc-123  ' })).toEqual({
      id: 'abc-123'
    })
  })

  test('Should drop any client-supplied snapshot field', () => {
    expect(
      normaliseReferenceSelection({
        id: 'abc-123',
        rssSnapshot: 'SHOULD-NOT-APPEAR',
        nameSnapshot: 'SHOULD-NOT-APPEAR'
      })
    ).toEqual({ id: 'abc-123' })
  })

  test('Should drop __proto__, constructor, and prototype keys', () => {
    const malicious = JSON.parse(
      '{"id": "abc-123", "__proto__": {"polluted": true}}'
    )
    const result = normaliseReferenceSelection(malicious)

    expect(result).toEqual({ id: 'abc-123' })
    expect({}.polluted).toBeUndefined()
  })

  test('Should preserve undefined and null', () => {
    expect(normaliseReferenceSelection(undefined)).toBeUndefined()
    expect(normaliseReferenceSelection(null)).toBeNull()
  })

  test('Should pass through a malformed (non-object) value unchanged', () => {
    expect(normaliseReferenceSelection('not-an-object')).toBe('not-an-object')
    expect(normaliseReferenceSelection(['array'])).toEqual(['array'])
  })

  test('Should not mutate the input', () => {
    const input = Object.freeze({ id: '  abc  ' })
    const result = normaliseReferenceSelection(input)

    expect(input).toEqual({ id: '  abc  ' })
    expect(result).not.toBe(input)
  })
})

describe('#normaliseArray', () => {
  test('Should map every entry', () => {
    expect(normaliseArray(['  a  ', '  b  '], (entry) => entry.trim())).toEqual(
      ['a', 'b']
    )
  })

  test('Should preserve undefined and null', () => {
    expect(normaliseArray(undefined, (entry) => entry)).toBeUndefined()
    expect(normaliseArray(null, (entry) => entry)).toBeNull()
  })

  test('Should pass through a non-array value unchanged', () => {
    expect(normaliseArray('not-an-array', (entry) => entry)).toBe(
      'not-an-array'
    )
    expect(normaliseArray({ not: 'an array' }, (entry) => entry)).toEqual({
      not: 'an array'
    })
  })

  test('Should return a new array, not the same reference', () => {
    const input = Object.freeze(['a', 'b'])
    const result = normaliseArray(input, (entry) => entry)

    expect(result).not.toBe(input)
    expect(result).toEqual(['a', 'b'])
  })
})

describe('#object-helpers architecture boundary', () => {
  test('Should not import Hapi, Boom, Joi, or MongoDB', () => {
    const source = readFileSync(
      new URL('./object-helpers.js', import.meta.url),
      'utf8'
    )

    expect(source).not.toMatch(/from\s+['"]@hapi\/hapi['"]/)
    expect(source).not.toMatch(/from\s+['"]@hapi\/boom['"]/)
    expect(source).not.toMatch(/from\s+['"]joi['"]/)
    expect(source).not.toMatch(/from\s+['"]mongodb['"]/)
  })
})
