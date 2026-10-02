import { buildSafeDetails } from './safe-details.js'

describe('#buildSafeDetails', () => {
  test('Should return an empty frozen array when details is not an array', () => {
    const result = buildSafeDetails(undefined)

    expect(result).toEqual([])
    expect(Object.isFrozen(result)).toBe(true)
  })

  test('Should keep only allow-listed fields from each detail', () => {
    const details = [
      {
        path: 'version',
        code: 'STALE_VERSION',
        message: 'The version is stale.',
        value: 'should-be-dropped',
        stack: 'should-be-dropped',
        authorizationToken: 'should-be-dropped'
      }
    ]

    const result = buildSafeDetails(details)

    expect(result).toEqual([
      {
        path: 'version',
        code: 'STALE_VERSION',
        message: 'The version is stale.'
      }
    ])
  })

  test('Should drop entries that are not plain objects', () => {
    const result = buildSafeDetails([
      'a string',
      42,
      null,
      ['nested', 'array'],
      { code: 'OK' }
    ])

    expect(result).toEqual([{ code: 'OK' }])
  })

  test('Should drop entries that contain no allow-listed fields', () => {
    const result = buildSafeDetails([
      { onlyUnsafeField: 'x' },
      { code: 'KEPT' }
    ])

    expect(result).toEqual([{ code: 'KEPT' }])
  })

  test('Should not copy inherited or prototype-polluting properties', () => {
    const detail = JSON.parse(
      '{"__proto__": {"polluted": true}, "code": "SAFE"}'
    )

    const result = buildSafeDetails([detail])

    expect(result).toEqual([{ code: 'SAFE' }])
    expect({}.polluted).toBeUndefined()
  })

  test('Should return frozen detail objects and a frozen array', () => {
    const result = buildSafeDetails([{ code: 'FROZEN' }])

    expect(Object.isFrozen(result)).toBe(true)
    expect(Object.isFrozen(result[0])).toBe(true)
  })

  test('Should not mutate the supplied details array or its objects', () => {
    const details = [{ code: 'X', value: 'unsafe' }]
    const snapshot = JSON.parse(JSON.stringify(details))

    buildSafeDetails(details)

    expect(details).toEqual(snapshot)
  })
})
