import { decideCompletionAccess } from './completion-policy.js'

describe('#decideCompletionAccess', () => {
  test('Should allow when the exact approved scope is present', () => {
    const outcome = decideCompletionAccess({
      authenticationContext: {
        userId: 'admin-1',
        scopes: ['catch-recording.complete']
      }
    })

    expect(outcome.decision).toBe('ALLOWED')
  })

  test('Should deny when the required scope is missing', () => {
    const outcome = decideCompletionAccess({
      authenticationContext: {
        userId: 'user-1',
        scopes: ['reference-data.read']
      }
    })

    expect(outcome.decision).toBe('ACCESS_DENIED')
  })

  test('Should deny an unauthenticated caller', () => {
    const outcome = decideCompletionAccess({ authenticationContext: undefined })

    expect(outcome.decision).toBe('AUTHENTICATION_REQUIRED')
  })

  test('Should deny an unknown scope', () => {
    const outcome = decideCompletionAccess({
      authenticationContext: { userId: 'user-1', scopes: ['unknown.scope'] }
    })

    expect(outcome.decision).toBe('ACCESS_DENIED')
  })

  test.each(['*', 'catch-recording.*', 'catch-recording.complete.extra'])(
    'Should deny a wildcard-looking or non-exact scope: %s',
    (scope) => {
      const outcome = decideCompletionAccess({
        authenticationContext: { userId: 'user-1', scopes: [scope] }
      })

      expect(outcome.decision).toBe('ACCESS_DENIED')
    }
  )

  test('Should not grant completion from owner status alone - there is no ownerUserId parameter to supply', () => {
    const outcome = decideCompletionAccess({
      authenticationContext: { userId: 'user-1', scopes: [] },
      ownerUserId: 'user-1'
    })

    expect(outcome.decision).toBe('ACCESS_DENIED')
  })

  test('Should accept no arbitrary target status - an extra status-like field has no effect', () => {
    const allowed = decideCompletionAccess({
      authenticationContext: {
        userId: 'admin-1',
        scopes: ['catch-recording.complete']
      },
      targetStatus: 'ANYTHING'
    })
    const denied = decideCompletionAccess({
      authenticationContext: { userId: 'user-1', scopes: [] },
      targetStatus: 'COMPLETE'
    })

    expect(allowed.decision).toBe('ALLOWED')
    expect(denied.decision).toBe('ACCESS_DENIED')
  })

  test('Should deny when scopes is missing or malformed', () => {
    expect(
      decideCompletionAccess({
        authenticationContext: { userId: 'user-1', scopes: undefined }
      }).decision
    ).toBe('ACCESS_DENIED')
    expect(
      decideCompletionAccess({
        authenticationContext: {
          userId: 'user-1',
          scopes: 'catch-recording.complete'
        }
      }).decision
    ).toBe('ACCESS_DENIED')
  })
})
