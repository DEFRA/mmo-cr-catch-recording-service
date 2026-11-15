import { parseVesselScopedRole } from './vessel-scoped-role.js'

describe('#parseVesselScopedRole', () => {
  test.each([
    ['VRO5--Owner', { vesselId: 'VRO5', roleId: 'Owner' }],
    ['PLDN--Skipper', { vesselId: 'PLDN', roleId: 'Skipper' }],
    ['rx-123--ReadOnlyUser', { vesselId: 'rx-123', roleId: 'ReadOnlyUser' }]
  ])(
    'Should split %s into its vessel and role exactly',
    (assigned, expected) => {
      const parsed = parseVesselScopedRole(assigned)

      expect(parsed).toEqual(expected)
      expect(Object.isFrozen(parsed)).toBe(true)
    }
  )

  test.each([
    ['an unscoped role', 'Owner'],
    ['a missing role', 'VRO5--'],
    ['a missing vessel', '--Owner'],
    ['a second separator', 'VRO5--Owner--Extra'],
    ['a triple hyphen', 'VRO5---Owner'],
    ['an empty string', ''],
    ['whitespace around the parts', 'VRO5 -- Owner'],
    ['an invalid vessel', 'V/O--Owner'],
    ['an invalid role', 'VRO5--Ow ner'],
    ['an over-long vessel', `${'V'.repeat(129)}--Owner`],
    ['a non-string', 42],
    ['null', null],
    ['undefined', undefined]
  ])('Should not recognise %s as a vessel role', (_name, value) => {
    expect(parseVesselScopedRole(value)).toBeNull()
  })
})
