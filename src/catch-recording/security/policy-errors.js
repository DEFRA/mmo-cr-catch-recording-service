import { ApplicationError } from '#/common/helpers/errors/application-error.js'
import { POLICY_DECISIONS, isAllowed } from './policy-outcome.js'

const AUTHENTICATION_REQUIRED_MESSAGE =
  'Authentication is required to access this resource.'
const ACCESS_DENIED_MESSAGE =
  'You do not have permission to perform this operation.'
const NOT_FOUND_MESSAGE = 'The requested resource could not be found.'

/**
 * The one safe mapping from a Step 14 policy outcome to the approved Step 03 `ApplicationError`. Reuses
 * the existing `AUTHENTICATION_FAILURE`/`AUTHORISATION_FAILURE`/`RESOURCE_NOT_FOUND` categories - no new
 * category or per-operation error code is introduced. Never includes the resource, owner, vessel
 * permission, or scope that produced the decision.
 *
 * @param {{ decision: string }} outcome
 * @throws {ApplicationError} when `outcome` is not `ALLOWED`
 */
export function enforcePolicyOutcome(outcome) {
  if (isAllowed(outcome)) {
    return
  }

  switch (outcome?.decision) {
    case POLICY_DECISIONS.AUTHENTICATION_REQUIRED:
      throw new ApplicationError({
        category: 'AUTHENTICATION_FAILURE',
        message: AUTHENTICATION_REQUIRED_MESSAGE
      })
    case POLICY_DECISIONS.ACCESS_DENIED:
      throw new ApplicationError({
        category: 'AUTHORISATION_FAILURE',
        message: ACCESS_DENIED_MESSAGE
      })
    case POLICY_DECISIONS.NOT_FOUND:
      throw new ApplicationError({
        category: 'RESOURCE_NOT_FOUND',
        message: NOT_FOUND_MESSAGE
      })
    default:
      throw new TypeError(
        `Unsupported policy outcome decision: ${String(outcome?.decision)}`
      )
  }
}
