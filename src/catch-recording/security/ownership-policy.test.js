import { decideOwnership } from './ownership-policy.js'

describe('#decideOwnership', () => {
  test('Should allow when the trusted caller matches the owner', () => {
    const outcome = decideOwnership({
      authenticationContext: { userId: 'user-1' },
      ownerUserId: 'user-1'
    })

    expect(outcome.decision).toBe('ALLOWED')
  })

  test('Should deny with NOT_FOUND when the trusted caller differs from the owner', () => {
    const outcome = decideOwnership({
      authenticationContext: { userId: 'user-1' },
      ownerUserId: 'user-2'
    })

    expect(outcome.decision).toBe('NOT_FOUND')
  })

  test('Should deny with AUTHENTICATION_REQUIRED when there is no authenticated caller', () => {
    expect(
      decideOwnership({ authenticationContext: null, ownerUserId: 'user-1' })
        .decision
    ).toBe('AUTHENTICATION_REQUIRED')
    expect(
      decideOwnership({
        authenticationContext: undefined,
        ownerUserId: 'user-1'
      }).decision
    ).toBe('AUTHENTICATION_REQUIRED')
  })

  test('Should deny with NOT_FOUND when the owner is missing or malformed', () => {
    expect(
      decideOwnership({
        authenticationContext: { userId: 'user-1' },
        ownerUserId: undefined
      }).decision
    ).toBe('NOT_FOUND')
    expect(
      decideOwnership({
        authenticationContext: { userId: 'user-1' },
        ownerUserId: ''
      }).decision
    ).toBe('NOT_FOUND')
    expect(
      decideOwnership({
        authenticationContext: { userId: 'user-1' },
        ownerUserId: 42
      }).decision
    ).toBe('NOT_FOUND')
  })

  test('Should not trust an inherited (prototype-chain) userId', () => {
    const prototype = { userId: 'user-1' }
    const context = Object.create(prototype)

    const outcome = decideOwnership({
      authenticationContext: context,
      ownerUserId: 'user-1'
    })

    expect(outcome.decision).toBe('AUTHENTICATION_REQUIRED')
  })

  test('Should not mutate its input', () => {
    const authenticationContext = Object.freeze({ userId: 'user-1' })

    expect(() =>
      decideOwnership({ authenticationContext, ownerUserId: 'user-1' })
    ).not.toThrow()
  })

  test('Should never expose the actual owner in the outcome', () => {
    const outcome = decideOwnership({
      authenticationContext: { userId: 'user-1' },
      ownerUserId: 'user-2'
    })

    expect(JSON.stringify(outcome)).not.toContain('user-2')
  })
})
