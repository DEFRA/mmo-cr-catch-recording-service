import { resolveCatchDetailAttribute } from './catch-detail-attributes.js'

describe('#resolveCatchDetailAttribute', () => {
  test.each(['LSC', 'BMS', 'DIS'])(
    'Should resolve the approved %s attribute',
    (attributeId) => {
      const { result, snapshot } = resolveCatchDetailAttribute({
        attributeId,
        path: ['gears', 0, 'speciesCaught', 0, 'catchDetails', 0]
      })

      expect(result.valid).toBe(true)
      expect(snapshot.nameSnapshot).toEqual(expect.any(String))
      expect(snapshot.unitSnapshot).toBe('kg')
    }
  )

  test('Should reject a missing attribute id', () => {
    const { result, snapshot } = resolveCatchDetailAttribute({
      attributeId: undefined,
      path: ['x']
    })

    expect(result.valid).toBe(false)
    expect(result.issues[0].code).toBe('REQUIRED')
    expect(snapshot).toBeNull()
  })

  test('Should reject a malformed attribute id', () => {
    const { result } = resolveCatchDetailAttribute({
      attributeId: 42,
      path: ['x']
    })

    expect(result.issues[0].code).toBe('INVALID_STRUCTURE')
  })

  test('Should reject an unrecognised attribute id', () => {
    const { result } = resolveCatchDetailAttribute({
      attributeId: 'UNKNOWN',
      path: ['x']
    })

    expect(result.issues[0].code).toBe('INVALID_REFERENCE')
  })

  test.each(['constructor', '__proto__', 'toString', 'hasOwnProperty'])(
    'Should reject a prototype-chain-like attribute id: %s',
    (attributeId) => {
      const { result, snapshot } = resolveCatchDetailAttribute({
        attributeId,
        path: ['x']
      })

      expect(result.valid).toBe(false)
      expect(result.issues[0].code).toBe('INVALID_REFERENCE')
      expect(snapshot).toBeNull()
    }
  )

  test('Should produce the correct canonical path', () => {
    const { result } = resolveCatchDetailAttribute({
      attributeId: undefined,
      path: ['gears', 0, 'speciesCaught', 0, 'catchDetails', 0]
    })

    expect(result.issues[0].path).toBe(
      'gears.0.speciesCaught.0.catchDetails.0.attributeId'
    )
  })
})
