import {
  POLICY_DECISIONS,
  allowOutcome,
  denyOutcome,
  isAllowed
} from './policy-outcome.js'

describe('#allowOutcome', () => {
  test('Should produce a frozen ALLOWED outcome', () => {
    const outcome = allowOutcome()

    expect(outcome).toEqual({ decision: 'ALLOWED' })
    expect(Object.isFrozen(outcome)).toBe(true)
  })
})

describe('#denyOutcome', () => {
  test.each([
    POLICY_DECISIONS.AUTHENTICATION_REQUIRED,
    POLICY_DECISIONS.ACCESS_DENIED,
    POLICY_DECISIONS.NOT_FOUND
  ])('Should produce a frozen outcome for %s', (decision) => {
    const outcome = denyOutcome(decision)

    expect(outcome).toEqual({ decision })
    expect(Object.isFrozen(outcome)).toBe(true)
  })

  test('Should reject ALLOWED as a denial decision', () => {
    expect(() => denyOutcome(POLICY_DECISIONS.ALLOWED)).toThrow()
  })

  test('Should reject an unsupported decision value', () => {
    expect(() => denyOutcome('SOMETHING_ELSE')).toThrow()
  })
})

describe('#isAllowed', () => {
  test('Should be true only for an ALLOWED outcome', () => {
    expect(isAllowed(allowOutcome())).toBe(true)
    expect(isAllowed(denyOutcome(POLICY_DECISIONS.ACCESS_DENIED))).toBe(false)
  })

  test('Should be false for a missing or malformed outcome', () => {
    expect(isAllowed(undefined)).toBe(false)
    expect(isAllowed(null)).toBe(false)
    expect(isAllowed({})).toBe(false)
  })
})
