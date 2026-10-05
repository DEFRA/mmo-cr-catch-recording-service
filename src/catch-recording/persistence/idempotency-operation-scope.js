/**
 * The closed, framework-neutral idempotency operation-scope contract.
 *
 * Owns: the exact set of operations approved for targeted idempotency integration — no more, no fewer —
 * taken directly from `design/plans/catch-recording-service-detailed-implementation-plan.md` §5.2
 * "Targeted idempotency". Has no MongoDB, Hapi, or Boom awareness.
 *
 * Does not: integrate idempotency into any of these operations (that is each later business step's own
 * work), add a generic/`ANY` scope, add a scope for ordinary section PATCH, a read operation, or any
 * administrative/cache/background-job concern.
 */

/**
 * The exact seven operations §5.2 approves for targeted idempotency. Ordinary section PATCH operations
 * are explicitly excluded by §5.2 and therefore have no scope value here.
 */
export const IDEMPOTENCY_OPERATION_SCOPES = Object.freeze({
  /** First persistent draft creation. */
  DRAFT_CREATION: 'DRAFT_CREATION',
  /** First submission. */
  SUBMISSION: 'SUBMISSION',
  /** Edit start when an audit event is created. */
  EDIT_START: 'EDIT_START',
  /** Resubmission. */
  RESUBMISSION: 'RESUBMISSION',
  /** Add favourite, where duplicate association creation is possible. */
  ADD_FAVOURITE: 'ADD_FAVOURITE',
  /** Add skipper, where duplicate vessel-owned entries are possible. */
  ADD_SKIPPER: 'ADD_SKIPPER',
  /** Completion, if the source may retry the command. */
  COMPLETION: 'COMPLETION'
})

const OPERATION_SCOPE_VALUES = Object.freeze(
  Object.values(IDEMPOTENCY_OPERATION_SCOPES)
)

/**
 * @param {unknown} value
 * @returns {boolean}
 */
export function isSupportedIdempotencyOperationScope(value) {
  return typeof value === 'string' && OPERATION_SCOPE_VALUES.includes(value)
}

/**
 * Validates an operation scope against the closed set. Rejects an arbitrary free-text operation name —
 * no new scope can be accepted without changing this module.
 *
 * @param {unknown} value
 * @returns {string} The validated scope, returned unchanged.
 */
export function validateOperationScope(value) {
  if (!isSupportedIdempotencyOperationScope(value)) {
    throw new TypeError(
      '"operationScope" must be one of the approved idempotency operation scopes'
    )
  }

  return value
}
