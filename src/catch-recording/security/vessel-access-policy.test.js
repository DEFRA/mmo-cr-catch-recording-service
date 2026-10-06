import { decideVesselAccess } from './vessel-access-policy.js'

const AUTH = { userId: 'user-1' }

describe('#decideVesselAccess', () => {
  test('Should allow when the vessel is in the trusted accessible set', () => {
    const outcome = decideVesselAccess({
      authenticationContext: AUTH,
      vesselId: 'vessel-1',
      accessibleVesselIds: ['vessel-1', 'vessel-2']
    })

    expect(outcome.decision).toBe('ALLOWED')
  })

  test('Should deny with ACCESS_DENIED for a different vessel', () => {
    const outcome = decideVesselAccess({
      authenticationContext: AUTH,
      vesselId: 'vessel-3',
      accessibleVesselIds: ['vessel-1', 'vessel-2']
    })

    expect(outcome.decision).toBe('ACCESS_DENIED')
  })

  test('Should deny when the accessible set is empty', () => {
    const outcome = decideVesselAccess({
      authenticationContext: AUTH,
      vesselId: 'vessel-1',
      accessibleVesselIds: []
    })

    expect(outcome.decision).toBe('ACCESS_DENIED')
  })

  test('Should allow correctly even with duplicate values in the accessible set', () => {
    const outcome = decideVesselAccess({
      authenticationContext: AUTH,
      vesselId: 'vessel-1',
      accessibleVesselIds: ['vessel-1', 'vessel-1']
    })

    expect(outcome.decision).toBe('ALLOWED')
  })

  test.each([undefined, null, '', 42, {}])(
    'Should deny a missing or malformed vesselId: %p',
    (vesselId) => {
      const outcome = decideVesselAccess({
        authenticationContext: AUTH,
        vesselId,
        accessibleVesselIds: ['vessel-1']
      })

      expect(outcome.decision).toBe('ACCESS_DENIED')
    }
  )

  test.each([undefined, null, 'vessel-1', [42], [{ id: 'vessel-1' }]])(
    'Should deny a malformed accessible set: %p',
    (accessibleVesselIds) => {
      const outcome = decideVesselAccess({
        authenticationContext: AUTH,
        vesselId: 'vessel-1',
        accessibleVesselIds
      })

      expect(outcome.decision).toBe('ACCESS_DENIED')
    }
  )

  test('Should deny a prototype-polluting-looking vessel id without special-casing it', () => {
    const outcome = decideVesselAccess({
      authenticationContext: AUTH,
      vesselId: '__proto__',
      accessibleVesselIds: ['vessel-1']
    })

    expect(outcome.decision).toBe('ACCESS_DENIED')
  })

  test('Should deny an unauthenticated caller before checking vessel access', () => {
    const outcome = decideVesselAccess({
      authenticationContext: undefined,
      vesselId: 'vessel-1',
      accessibleVesselIds: ['vessel-1']
    })

    expect(outcome.decision).toBe('AUTHENTICATION_REQUIRED')
  })

  test('Should ignore an untrusted payload-shaped vessel permission (not its own input channel)', () => {
    // decideVesselAccess has no payload/body parameter at all - this test documents that fact: supplying
    // a vessel permission as `accessibleVesselIds` is the only input channel, so a caller cannot smuggle
    // a trusted-looking permission through any other property.
    const outcome = decideVesselAccess({
      authenticationContext: AUTH,
      vesselId: 'vessel-1',
      accessibleVesselIds: ['vessel-2'],
      payload: { accessibleVesselIds: ['vessel-1'] }
    })

    expect(outcome.decision).toBe('ACCESS_DENIED')
  })

  test('Should not mutate its input', () => {
    const accessibleVesselIds = Object.freeze(['vessel-1'])

    expect(() =>
      decideVesselAccess({
        authenticationContext: AUTH,
        vesselId: 'vessel-1',
        accessibleVesselIds
      })
    ).not.toThrow()
  })
})
