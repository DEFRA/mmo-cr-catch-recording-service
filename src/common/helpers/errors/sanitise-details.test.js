import { sanitiseDetails } from './sanitise-details.js'

describe('#sanitiseDetails', () => {
  test('Should return undefined for a non-array input', () => {
    expect(sanitiseDetails(undefined)).toBeUndefined()
    expect(sanitiseDetails(null)).toBeUndefined()
    expect(sanitiseDetails('not-an-array')).toBeUndefined()
    expect(sanitiseDetails({})).toBeUndefined()
  })

  test('Should return undefined for an empty array', () => {
    expect(sanitiseDetails([])).toBeUndefined()
  })

  test('Should keep every allowed field', () => {
    const result = sanitiseDetails([
      {
        path: 'version',
        code: 'STALE_VERSION',
        message: 'Version is out of date',
        min: 1,
        max: 10,
        format: 'integer',
        allowedValues: ['DRAFT', 'SUBMITTED']
      }
    ])

    expect(result).toEqual([
      {
        path: 'version',
        code: 'STALE_VERSION',
        message: 'Version is out of date',
        min: 1,
        max: 10,
        format: 'integer',
        allowedValues: ['DRAFT', 'SUBMITTED']
      }
    ])
  })

  test('Should remove unsupported fields rather than copy them', () => {
    const result = sanitiseDetails([
      {
        path: 'species',
        code: 'INVALID',
        value: 'raw submitted value',
        context: { unsafe: true },
        stack: 'at Object.<anonymous>'
      }
    ])

    expect(result).toEqual([{ path: 'species', code: 'INVALID' }])
  })

  test('Should never copy a submitted value even under an unapproved field name', () => {
    const result = sanitiseDetails([
      { path: 'id', submittedValue: 'secret-id', value: 123 }
    ])

    expect(result).toEqual([{ path: 'id' }])
  })

  test('Should join an array path into a safe string', () => {
    const result = sanitiseDetails([
      { path: ['gears', 0, 'species'], code: 'DUPLICATE' }
    ])

    expect(result).toEqual([{ path: 'gears.0.species', code: 'DUPLICATE' }])
  })

  test('Should drop an unsafe path value', () => {
    const result = sanitiseDetails([
      { path: { unsafe: true }, code: 'DUPLICATE' }
    ])

    expect(result).toEqual([{ code: 'DUPLICATE' }])
  })

  test('Should drop a path array that contains no safe segments', () => {
    const result = sanitiseDetails([
      { path: [{ unsafe: true }, null], code: 'DUPLICATE' }
    ])

    expect(result).toEqual([{ code: 'DUPLICATE' }])
  })

  test('Should filter allowedValues to safe primitive values only', () => {
    const result = sanitiseDetails([
      {
        path: 'status',
        allowedValues: [
          'DRAFT',
          1,
          true,
          { nested: 'unsafe' },
          ['nested-array'],
          null
        ]
      }
    ])

    expect(result).toEqual([
      { path: 'status', allowedValues: ['DRAFT', 1, true] }
    ])
  })

  test('Should omit allowedValues entirely when nothing safe remains', () => {
    const result = sanitiseDetails([
      { path: 'status', allowedValues: [{ nested: true }] }
    ])

    expect(result).toEqual([{ path: 'status' }])
  })

  test('Should omit a non-array allowedValues value', () => {
    const result = sanitiseDetails([
      { path: 'status', allowedValues: 'not-an-array' }
    ])

    expect(result).toEqual([{ path: 'status' }])
  })

  test('Should omit an entry that has no safe fields at all', () => {
    const result = sanitiseDetails([
      { value: 'only unsafe data' },
      { path: 'field' }
    ])

    expect(result).toEqual([{ path: 'field' }])
  })

  test('Should return undefined when every entry is unsafe', () => {
    expect(
      sanitiseDetails([{ value: 'unsafe' }, 'not-an-object', null, 42])
    ).toBeUndefined()
  })

  test('Should handle multiple details', () => {
    const result = sanitiseDetails([
      { path: 'a', code: 'ONE' },
      { path: 'b', code: 'TWO' }
    ])

    expect(result).toEqual([
      { path: 'a', code: 'ONE' },
      { path: 'b', code: 'TWO' }
    ])
  })

  test('Should not mutate the caller-supplied details array or its entries', () => {
    const details = [{ path: 'field', code: 'REQUIRED', value: 'raw' }]
    const detailsCopy = JSON.parse(JSON.stringify(details))

    const result = sanitiseDetails(details)

    expect(details).toEqual(detailsCopy)
    expect(result).not.toBe(details)
    expect(result[0]).not.toBe(details[0])
  })

  test('Should ignore prototype-polluting shaped input without throwing', () => {
    const malicious = JSON.parse(
      '{"path": "ok", "__proto__": {"polluted": true}}'
    )

    expect(() => sanitiseDetails([malicious])).not.toThrow()
    expect(sanitiseDetails([malicious])).toEqual([{ path: 'ok' }])
    expect({}.polluted).toBeUndefined()
  })
})
