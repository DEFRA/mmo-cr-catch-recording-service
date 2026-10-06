import { decideVesselProfileAccess } from './vessel-profile-policy.js'

const AUTH = { userId: 'user-1' }

describe('#decideVesselProfileAccess', () => {
  test('Should allow approved vessel access', () => {
    const outcome = decideVesselProfileAccess({
      authenticationContext: AUTH,
      vesselId: 'vessel-1',
      accessibleVesselIds: ['vessel-1']
    })

    expect(outcome.decision).toBe('ALLOWED')
  })

  test('Should deny a different vessel', () => {
    const outcome = decideVesselProfileAccess({
      authenticationContext: AUTH,
      vesselId: 'vessel-2',
      accessibleVesselIds: ['vessel-1']
    })

    expect(outcome.decision).toBe('ACCESS_DENIED')
  })

  test('Should deny a missing permission set', () => {
    const outcome = decideVesselProfileAccess({
      authenticationContext: AUTH,
      vesselId: 'vessel-1',
      accessibleVesselIds: undefined
    })

    expect(outcome.decision).toBe('ACCESS_DENIED')
  })

  test('Should grant no global skipper or reference-data permission - the outcome never carries any extra capability field', () => {
    const outcome = decideVesselProfileAccess({
      authenticationContext: AUTH,
      vesselId: 'vessel-1',
      accessibleVesselIds: ['vessel-1']
    })

    expect(Object.keys(outcome)).toEqual(['decision'])
  })
})
