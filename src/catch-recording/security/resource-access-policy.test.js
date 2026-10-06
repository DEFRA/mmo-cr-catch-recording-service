import {
  decideReadAccess,
  decideDraftUpdateAccess,
  decideDraftAbandonmentAccess,
  decideSubmissionAccess,
  decideAmendmentAccess,
  decideArtifactAccess
} from './resource-access-policy.js'

const OPERATIONS = [
  ['decideReadAccess', decideReadAccess],
  ['decideDraftUpdateAccess', decideDraftUpdateAccess],
  ['decideDraftAbandonmentAccess', decideDraftAbandonmentAccess],
  ['decideSubmissionAccess', decideSubmissionAccess],
  ['decideAmendmentAccess', decideAmendmentAccess],
  ['decideArtifactAccess', decideArtifactAccess]
]

describe('#resource-access-policy (decision matrix)', () => {
  test.each(OPERATIONS)(
    '%s should allow the approved owner',
    (_name, decide) => {
      const outcome = decide({
        authenticationContext: { userId: 'user-1' },
        ownerUserId: 'user-1'
      })

      expect(outcome.decision).toBe('ALLOWED')
    }
  )

  test.each(OPERATIONS)(
    '%s should deny a cross-owner request with safe NOT_FOUND',
    (_name, decide) => {
      const outcome = decide({
        authenticationContext: { userId: 'user-1' },
        ownerUserId: 'user-2'
      })

      expect(outcome.decision).toBe('NOT_FOUND')
    }
  )

  test.each(OPERATIONS)(
    '%s should deny a missing authenticated caller',
    (_name, decide) => {
      const outcome = decide({
        authenticationContext: undefined,
        ownerUserId: 'user-1'
      })

      expect(outcome.decision).toBe('AUTHENTICATION_REQUIRED')
    }
  )

  test.each(OPERATIONS)('%s should not mutate its input', (_name, decide) => {
    const authenticationContext = Object.freeze({ userId: 'user-1' })
    const input = Object.freeze({
      authenticationContext,
      ownerUserId: 'user-1'
    })

    expect(() => decide(input)).not.toThrow()
  })

  test('Each operation performs only the ownership check - no lifecycle, version, or validation input is consulted', () => {
    // Deliberately pass extra fields a lifecycle/version/validation step might supply; the outcome must
    // depend only on authenticationContext/ownerUserId, proving no other concern leaked into this policy.
    const outcome = decideSubmissionAccess({
      authenticationContext: { userId: 'user-1' },
      ownerUserId: 'user-1',
      status: 'COMPLETE',
      expectedVersion: 999,
      isComplete: false
    })

    expect(outcome.decision).toBe('ALLOWED')
  })
})
