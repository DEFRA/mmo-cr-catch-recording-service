import { enforcePolicyOutcome } from './policy-errors.js'
import {
  allowOutcome,
  denyOutcome,
  POLICY_DECISIONS
} from './policy-outcome.js'
import { isApplicationError } from '#/common/helpers/errors/application-error.js'

describe('#enforcePolicyOutcome', () => {
  test('Should not throw for an ALLOWED outcome', () => {
    expect(() => enforcePolicyOutcome(allowOutcome())).not.toThrow()
  })

  test('Should throw AUTHENTICATION_FAILURE for AUTHENTICATION_REQUIRED', () => {
    try {
      enforcePolicyOutcome(
        denyOutcome(POLICY_DECISIONS.AUTHENTICATION_REQUIRED)
      )
      throw new Error('expected enforcePolicyOutcome to throw')
    } catch (error) {
      expect(isApplicationError(error)).toBe(true)
      expect(error.category).toBe('AUTHENTICATION_FAILURE')
      expect(error.code).toBe('AUTHENTICATION_REQUIRED')
    }
  })

  test('Should throw AUTHORISATION_FAILURE for ACCESS_DENIED', () => {
    try {
      enforcePolicyOutcome(denyOutcome(POLICY_DECISIONS.ACCESS_DENIED))
      throw new Error('expected enforcePolicyOutcome to throw')
    } catch (error) {
      expect(isApplicationError(error)).toBe(true)
      expect(error.category).toBe('AUTHORISATION_FAILURE')
      expect(error.code).toBe('ACCESS_DENIED')
    }
  })

  test('Should throw RESOURCE_NOT_FOUND for NOT_FOUND', () => {
    try {
      enforcePolicyOutcome(denyOutcome(POLICY_DECISIONS.NOT_FOUND))
      throw new Error('expected enforcePolicyOutcome to throw')
    } catch (error) {
      expect(isApplicationError(error)).toBe(true)
      expect(error.category).toBe('RESOURCE_NOT_FOUND')
      expect(error.code).toBe('RESOURCE_NOT_FOUND')
    }
  })

  test('Should reject an unsupported outcome shape', () => {
    expect(() => enforcePolicyOutcome({ decision: 'NONSENSE' })).toThrow(
      TypeError
    )
  })

  test('Should never include resource, owner, or scope data in the thrown error', () => {
    try {
      enforcePolicyOutcome(denyOutcome(POLICY_DECISIONS.NOT_FOUND))
      throw new Error('expected enforcePolicyOutcome to throw')
    } catch (error) {
      const serialised = JSON.stringify(error.toJSON())
      expect(serialised).not.toContain('ownerUserId')
      expect(serialised).not.toContain('vesselId')
    }
  })
})
