import {
  LIFECYCLE_DECISION_CODES,
  createAllowedDecision,
  createDeniedDecision,
  isLifecycleDecisionCode
} from './catch-record-lifecycle-decision.js'

describe('LIFECYCLE_DECISION_CODES', () => {
  test('Should contain exactly the approved, non-speculative codes', () => {
    expect(LIFECYCLE_DECISION_CODES).toEqual([
      'LIFECYCLE_OPERATION_ALLOWED',
      'PERSISTED_STATUS_UNSUPPORTED',
      'DOMAIN_STATE_INCONSISTENT',
      'DRAFT_ABANDONMENT_NOT_ALLOWED',
      'FIRST_SUBMISSION_NOT_ALLOWED',
      'AMENDMENT_NOT_ALLOWED',
      'RESUBMISSION_NOT_ALLOWED',
      'COMPLETION_NOT_ALLOWED',
      'SUBMISSION_COUNT_INVALID',
      'SUBMISSION_COUNT_LIMIT_REACHED',
      'UNSUBMITTED_CHANGES_STATE_INVALID',
      'AUDIT_EXPECTATION_NOT_MET',
      'ARTIFACT_EXPECTATION_NOT_MET'
    ])
  })

  test('Should be frozen', () => {
    expect(Object.isFrozen(LIFECYCLE_DECISION_CODES)).toBe(true)
  })
})

describe('#isLifecycleDecisionCode', () => {
  test('Should accept an approved code', () => {
    expect(isLifecycleDecisionCode('AMENDMENT_NOT_ALLOWED')).toBe(true)
  })

  test('Should reject a speculative/unapproved code', () => {
    expect(isLifecycleDecisionCode('MADE_UP_CODE')).toBe(false)
  })
})

describe('#createAllowedDecision', () => {
  test('Should build an allowed decision', () => {
    const decision = createAllowedDecision('LIFECYCLE_OPERATION_ALLOWED', 'ok')

    expect(decision).toEqual({
      allowed: true,
      code: 'LIFECYCLE_OPERATION_ALLOWED',
      reason: 'ok'
    })
  })

  test('Should be frozen, including details', () => {
    const decision = createAllowedDecision(
      'LIFECYCLE_OPERATION_ALLOWED',
      'ok',
      {
        status: 'DRAFT'
      }
    )

    expect(Object.isFrozen(decision)).toBe(true)
    expect(Object.isFrozen(decision.details)).toBe(true)
  })

  test('Should reject an unsupported code', () => {
    expect(() => createAllowedDecision('NOT_A_CODE', 'ok')).toThrow()
  })
})

describe('#createDeniedDecision', () => {
  test('Should build a denied decision with a stable code and safe reason', () => {
    const decision = createDeniedDecision(
      'AMENDMENT_NOT_ALLOWED',
      'The catch record is not eligible for amendment.'
    )

    expect(decision.allowed).toBe(false)
    expect(decision.code).toBe('AMENDMENT_NOT_ALLOWED')
  })

  test('Should not contain a stack trace or cause', () => {
    const decision = createDeniedDecision(
      'AMENDMENT_NOT_ALLOWED',
      'Not eligible.'
    )

    expect(decision).not.toHaveProperty('stack')
    expect(decision).not.toHaveProperty('cause')
  })
})
