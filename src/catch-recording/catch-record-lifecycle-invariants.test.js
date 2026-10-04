import {
  CATCH_RECORD_LIFECYCLE_TRANSITIONS,
  evaluateLifecycleInvariant
} from './catch-record-lifecycle-invariants.js'

describe('CATCH_RECORD_LIFECYCLE_TRANSITIONS', () => {
  test('Should represent every approved transition', () => {
    const transitions = CATCH_RECORD_LIFECYCLE_TRANSITIONS.map(
      (t) => `${t.from}->${t.to}:${t.trigger}`
    )

    expect(transitions).toEqual([
      'null->DRAFT:persistentCreation',
      'DRAFT->SUBMITTED:firstSubmission',
      'SUBMITTED->COMPLETE:completion',
      'SUBMITTED->DRAFT:editStart',
      'COMPLETE->DRAFT:editStart',
      'DRAFT->SUBMITTED:resubmission'
    ])
  })

  test('Should be frozen (including every entry)', () => {
    expect(Object.isFrozen(CATCH_RECORD_LIFECYCLE_TRANSITIONS)).toBe(true)
    expect(Object.isFrozen(CATCH_RECORD_LIFECYCLE_TRANSITIONS[0])).toBe(true)
  })

  test('Should not represent any prohibited transition', () => {
    const prohibited = [
      'DRAFT->COMPLETE',
      'COMPLETE->SUBMITTED',
      'SUBMITTED->SUBMITTED',
      'COMPLETE->COMPLETE',
      'DRAFT->DRAFT'
    ]
    const represented = CATCH_RECORD_LIFECYCLE_TRANSITIONS.map(
      (t) => `${t.from}->${t.to}`
    )

    for (const pair of prohibited) {
      expect(represented).not.toContain(pair)
    }
  })

  test('Should not expose an executable canTransition dispatcher (data only)', () => {
    expect(Array.isArray(CATCH_RECORD_LIFECYCLE_TRANSITIONS)).toBe(true)
    expect(typeof CATCH_RECORD_LIFECYCLE_TRANSITIONS).not.toBe('function')
  })
})

describe('#evaluateLifecycleInvariant', () => {
  test('Should accept a never-submitted draft', () => {
    expect(
      evaluateLifecycleInvariant({
        status: 'DRAFT',
        numberOfSubmissions: 0,
        hasUnsubmittedChanges: false
      }).allowed
    ).toBe(true)
  })

  test('Should reject a never-submitted draft with pending unsubmitted changes', () => {
    expect(
      evaluateLifecycleInvariant({
        status: 'DRAFT',
        numberOfSubmissions: 0,
        hasUnsubmittedChanges: true
      }).allowed
    ).toBe(false)
  })

  test.each([true, false])(
    'Should accept an amended draft regardless of hasUnsubmittedChanges=%s (user-approved decision)',
    (hasUnsubmittedChanges) => {
      expect(
        evaluateLifecycleInvariant({
          status: 'DRAFT',
          numberOfSubmissions: 2,
          hasUnsubmittedChanges
        }).allowed
      ).toBe(true)
    }
  )

  test('Should accept a submitted record', () => {
    expect(
      evaluateLifecycleInvariant({
        status: 'SUBMITTED',
        numberOfSubmissions: 1,
        hasUnsubmittedChanges: false
      }).allowed
    ).toBe(true)
  })

  test('Should accept a complete record', () => {
    expect(
      evaluateLifecycleInvariant({
        status: 'COMPLETE',
        numberOfSubmissions: 1,
        hasUnsubmittedChanges: false
      }).allowed
    ).toBe(true)
  })

  test.each(['SUBMITTED', 'COMPLETE'])(
    'Should reject %s with zero submissions as inconsistent',
    (status) => {
      const result = evaluateLifecycleInvariant({
        status,
        numberOfSubmissions: 0,
        hasUnsubmittedChanges: false
      })

      expect(result.allowed).toBe(false)
      expect(result.code).toBe('DOMAIN_STATE_INCONSISTENT')
    }
  )

  test.each(['SUBMITTED', 'COMPLETE'])(
    'Should reject %s with pending unsubmitted changes as inconsistent',
    (status) => {
      expect(
        evaluateLifecycleInvariant({
          status,
          numberOfSubmissions: 1,
          hasUnsubmittedChanges: true
        }).allowed
      ).toBe(false)
    }
  )

  test('Should reject a negative submission count as inconsistent (not repaired)', () => {
    const result = evaluateLifecycleInvariant({
      status: 'DRAFT',
      numberOfSubmissions: -1,
      hasUnsubmittedChanges: false
    })

    expect(result.allowed).toBe(false)
    expect(result.code).toBe('DOMAIN_STATE_INCONSISTENT')
  })

  test('Should reject an unsupported persisted status', () => {
    const result = evaluateLifecycleInvariant({
      status: 'DRAFT_EDIT',
      numberOfSubmissions: 0,
      hasUnsubmittedChanges: false
    })

    expect(result.code).toBe('PERSISTED_STATUS_UNSUPPORTED')
  })

  test('Should reject a non-boolean hasUnsubmittedChanges', () => {
    const result = evaluateLifecycleInvariant({
      status: 'DRAFT',
      numberOfSubmissions: 0,
      hasUnsubmittedChanges: 'false'
    })

    expect(result.allowed).toBe(false)
  })

  test('Should be deterministic for equivalent input', () => {
    const input = {
      status: 'DRAFT',
      numberOfSubmissions: 0,
      hasUnsubmittedChanges: false
    }

    expect(evaluateLifecycleInvariant(input)).toEqual(
      evaluateLifecycleInvariant(input)
    )
  })

  test('Should not mutate its input', () => {
    const input = {
      status: 'DRAFT',
      numberOfSubmissions: 0,
      hasUnsubmittedChanges: false
    }
    const snapshot = { ...input }

    evaluateLifecycleInvariant(input)

    expect(input).toEqual(snapshot)
  })
})
