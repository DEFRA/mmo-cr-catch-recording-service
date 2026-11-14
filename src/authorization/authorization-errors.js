import { ApplicationError } from '#/common/helpers/errors/application-error.js'
import {
  AuthorizationOutcome,
  UnavailableReason
} from './capability-authorizer.js'

const ACCESS_DENIED_MESSAGE =
  'You do not have permission to perform this operation.'
const UNAVAILABLE_MESSAGE =
  'The service is temporarily unable to authorise this request.'
const INTERNAL_MESSAGE = 'An unexpected error occurred.'

// Failures of this service's own wiring rather than of a dependency: never reported as a dependency outage
const INTERNAL_REASONS = new Set([
  UnavailableReason.UNTRUSTED_USER_CONTEXT,
  UnavailableReason.INVALID_REQUIRED_CAPABILITY,
  UnavailableReason.INTERNAL_FAILURE
])

/** A route is protected but its capability mapping is absent or invalid: a configuration failure. */
export function missingMappingError() {
  return new ApplicationError({
    category: 'UNEXPECTED_INTERNAL_FAILURE',
    message: INTERNAL_MESSAGE,
    meta: { reason: 'MISSING_CAPABILITY_MAPPING' }
  })
}

/**
 * Maps a non-allowed Step 09 decision to the existing typed application errors (no new category):
 * a valid denial -> `AUTHORISATION_FAILURE`, authorization data that cannot be evaluated ->
 * `DEPENDENCY_UNAVAILABLE`, an internal wiring failure -> `UNEXPECTED_INTERNAL_FAILURE`. Denied and
 * unavailable are never collapsed. The reason stays internal (`meta`) and is never serialised publicly.
 *
 * @param {{ outcome: string, reason?: string }} decision
 * @returns {ApplicationError}
 */
export function authorizationDecisionError(decision) {
  const meta = { reason: decision.reason }

  if (decision.outcome === AuthorizationOutcome.DENIED) {
    return new ApplicationError({
      category: 'AUTHORISATION_FAILURE',
      message: ACCESS_DENIED_MESSAGE,
      meta
    })
  }

  if (
    decision.outcome === AuthorizationOutcome.UNAVAILABLE &&
    !INTERNAL_REASONS.has(decision.reason)
  ) {
    return new ApplicationError({
      category: 'DEPENDENCY_UNAVAILABLE',
      message: UNAVAILABLE_MESSAGE,
      meta
    })
  }

  return new ApplicationError({
    category: 'UNEXPECTED_INTERNAL_FAILURE',
    message: INTERNAL_MESSAGE,
    meta
  })
}

/** The authorizer is not configured (local development only): authorization cannot be evaluated. */
export function authorizerUnavailableError() {
  return new ApplicationError({
    category: 'DEPENDENCY_UNAVAILABLE',
    message: UNAVAILABLE_MESSAGE,
    meta: { reason: 'AUTHORIZER_NOT_CONFIGURED' }
  })
}
