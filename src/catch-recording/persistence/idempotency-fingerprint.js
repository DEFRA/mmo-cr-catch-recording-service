import { createHash } from 'node:crypto'

import { validateOperationScope } from './idempotency-operation-scope.js'
import { validateIdempotencyKey } from './idempotency-key.js'

/**
 * The deterministic, framework-neutral request-fingerprint contract.
 *
 * Owns: a stable mechanism for deciding whether a reused idempotency key is being replayed for the same
 * semantic request. Has no MongoDB, Hapi, or Boom awareness.
 *
 * Does not: define which fields are semantically relevant for any given business operation (`allowedFields`
 * is always supplied by the calling later operation — see the Step 12 plan's "Deterministic
 * request-fingerprint contract" decision), build a generic arbitrary-object canonicalisation framework, or
 * accept a caller-supplied fingerprint directly as the semantic input.
 *
 * Excludes secrets, tokens, credentials, headers, correlation/trace IDs, and per-retry timestamps *by
 * construction*: nothing can reach the hash unless the calling operation names it in `allowedFields` and
 * supplies it in `semanticInput` — this module never reads, infers, or special-cases any transport-layer
 * field.
 */

const FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/

const MAX_SEMANTIC_NESTING_DEPTH = 5

const DISALLOWED_SEMANTIC_KEYS = Object.freeze([
  '__proto__',
  'constructor',
  'prototype'
])

/**
 * Recursively rejects anything that is not a JSON-safe value (`string`, finite `number`, `boolean`,
 * `null`, or a nested plain object/array of the same), bounded to `MAX_SEMANTIC_NESTING_DEPTH` levels.
 * Structurally excludes functions, symbols, `undefined`, `Date` instances, `Map`/`Set`, and prototype-
 * pollution-shaped keys at every level.
 *
 * @param {unknown} value
 * @param {number} depth
 */
function assertJsonSafeValue(value, depth) {
  if (depth > MAX_SEMANTIC_NESTING_DEPTH) {
    throw new TypeError(
      '"semanticInput" is nested more deeply than the approved fingerprint bound allows'
    )
  }

  if (value === null) {
    return
  }

  const type = typeof value

  if (type === 'string' || type === 'boolean') {
    return
  }

  if (type === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError(
        '"semanticInput" must contain only finite numbers, never NaN or Infinity'
      )
    }
    return
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      assertJsonSafeValue(item, depth + 1)
    }
    return
  }

  if (type === 'object') {
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) {
      // Rejects `Date`, `Map`, `Set`, `RegExp`, and any other exotic/class-instance object by
      // construction — a plain object is the only object shape a JSON-safe fingerprint input may take.
      throw new TypeError(
        '"semanticInput" must contain only plain objects, never a Date, Map, Set, RegExp, or class instance'
      )
    }

    for (const key of Object.keys(value)) {
      if (DISALLOWED_SEMANTIC_KEYS.includes(key)) {
        throw new TypeError(`"${key}" is not an allowed fingerprint field`)
      }
      assertJsonSafeValue(value[key], depth + 1)
    }
    return
  }

  throw new TypeError(
    '"semanticInput" must be JSON-safe (no functions, symbols, undefined values, or Date instances)'
  )
}

/**
 * Rejects any `semanticInput` key that is not exactly present in the caller-supplied `allowedFields` —
 * the only place an "allow-list" exists in this module; Step 12 never hard-codes a business field name.
 *
 * @param {unknown} semanticInput
 * @param {unknown} allowedFields
 */
function assertAllowedSemanticInput(semanticInput, allowedFields) {
  if (
    semanticInput === null ||
    typeof semanticInput !== 'object' ||
    Array.isArray(semanticInput)
  ) {
    throw new TypeError('"semanticInput" must be a plain object')
  }

  if (!Array.isArray(allowedFields) || allowedFields.length === 0) {
    throw new TypeError(
      '"allowedFields" must be a non-empty array of field names'
    )
  }

  for (const key of Object.keys(semanticInput)) {
    if (
      DISALLOWED_SEMANTIC_KEYS.includes(key) ||
      !allowedFields.includes(key)
    ) {
      throw new TypeError(`"${key}" is not an allow-listed fingerprint field`)
    }
  }

  assertJsonSafeValue(semanticInput, 0)
}

/**
 * Recursively sorts object keys so the hash input never depends on property-insertion order. Array order
 * is preserved — it is semantically meaningful, unlike object key order.
 *
 * @param {unknown} value
 * @returns {unknown}
 */
function canonicalise(value) {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalise(item))
  }

  if (value !== null && typeof value === 'object') {
    const sortedKeys = Object.keys(value).sort()
    const canonicalObject = {}
    for (const key of sortedKeys) {
      canonicalObject[key] = canonicalise(value[key])
    }
    return canonicalObject
  }

  return value
}

/**
 * Computes a deterministic SHA-256 fingerprint of `{ operationScope, idempotencyKey, semanticInput }`.
 * `semanticInput`'s keys must be an explicit subset of the caller-supplied `allowedFields` — anything
 * else is rejected before it can ever reach the hash.
 *
 * @param {{
 *   operationScope: string,
 *   idempotencyKey: string,
 *   allowedFields: string[],
 *   semanticInput: object
 * }} params
 * @returns {string} A 64-character lowercase hexadecimal SHA-256 digest.
 */
export function computeRequestFingerprint({
  operationScope,
  idempotencyKey,
  allowedFields,
  semanticInput
}) {
  validateOperationScope(operationScope)
  validateIdempotencyKey(idempotencyKey)
  assertAllowedSemanticInput(semanticInput, allowedFields)

  const canonicalPayload = canonicalise({
    operationScope,
    idempotencyKey,
    semanticInput
  })

  return createHash('sha256')
    .update(JSON.stringify(canonicalPayload))
    .digest('hex')
}

/**
 * Validates a pre-computed fingerprint has exactly the shape `computeRequestFingerprint` produces.
 * Structurally rejects a caller accidentally passing a raw request body/payload, a raw secret, or any
 * other arbitrary string as "the fingerprint" — none of those can ever match a 64-character lowercase
 * hex SHA-256 digest.
 *
 * @param {unknown} value
 * @returns {string} The validated fingerprint, returned unchanged.
 */
export function assertFingerprint(value) {
  if (typeof value !== 'string' || !FINGERPRINT_PATTERN.test(value)) {
    throw new TypeError(
      '"fingerprint" must be a 64-character lowercase hexadecimal SHA-256 digest'
    )
  }

  return value
}
