import { importJWK } from 'jose'

import { fetchBoundedJson } from './bounded-json-fetch.js'
import { SigningKeyError, SigningKeyFailure } from './signing-key-failure.js'

const MAX_JWKS_BYTES = 256 * 1024
const MAX_JWKS_KEYS = 20
const MINIMUM_RSA_MODULUS_BYTES = 256
const MAXIMUM_EXPONENT_BYTES = 8
const PRIVATE_KEY_MEMBERS = ['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth', 'k']

const isPlainObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

function hasPlausibleExponent(encodedExponent) {
  const exponent = Buffer.from(encodedExponent, 'base64url')
  return (
    exponent.length > 0 &&
    exponent.length <= MAXIMUM_EXPONENT_BYTES &&
    exponent.at(-1) % 2 === 1 &&
    exponent.some((byte, index) => index < exponent.length - 1 || byte > 1)
  )
}

function hasSigningUse(jwk, allowedAlgorithms) {
  return (
    (jwk.use === undefined || jwk.use === 'sig') &&
    (jwk.alg === undefined || allowedAlgorithms.includes(jwk.alg)) &&
    (jwk.key_ops === undefined ||
      (Array.isArray(jwk.key_ops) && jwk.key_ops.includes('verify')))
  )
}

function hasPublicRsaMembers(jwk) {
  return (
    jwk.kty === 'RSA' &&
    typeof jwk.n === 'string' &&
    typeof jwk.e === 'string' &&
    PRIVATE_KEY_MEMBERS.every((member) => jwk[member] === undefined)
  )
}

function isCompatibleSigningKey(jwk, allowedAlgorithms) {
  return (
    hasPublicRsaMembers(jwk) &&
    hasSigningUse(jwk, allowedAlgorithms) &&
    hasPlausibleExponent(jwk.e) &&
    Buffer.from(jwk.n, 'base64url').length >= MINIMUM_RSA_MODULUS_BYTES
  )
}

function hasKeyId(jwk) {
  return isPlainObject(jwk) && typeof jwk.kid === 'string' && jwk.kid.length > 0
}

function isCandidateKey(jwk, allowedAlgorithms) {
  return hasKeyId(jwk) && isCompatibleSigningKey(jwk, allowedAlgorithms)
}

function isUsableKeySet(document) {
  return (
    isPlainObject(document) &&
    Array.isArray(document.keys) &&
    document.keys.length <= MAX_JWKS_KEYS
  )
}

async function importPublicKey(jwk, algorithm) {
  try {
    // Only the public members are handed to the library, which performs the key construction.
    return await importJWK({ kty: jwk.kty, n: jwk.n, e: jwk.e }, algorithm)
  } catch {
    return null
  }
}

function assertUniqueKeyIds(keys) {
  const keyIds = keys
    .filter((jwk) => isPlainObject(jwk) && typeof jwk.kid === 'string')
    .map((jwk) => jwk.kid)

  if (new Set(keyIds).size !== keyIds.length) {
    throw new SigningKeyError(SigningKeyFailure.JWKS_INVALID)
  }
}

/**
 * Retrieves a JSON Web Key Set from the validated `jwks_uri` and converts it into verification keys.
 * Only well-formed RSA public signing keys with a unique, non-empty `kid` are accepted; any other key
 * is ignored, never selected as a fallback.
 *
 * @param {Object} options
 * @param {number} options.timeoutMs
 * @param {string[]} options.allowedAlgorithms configured `entra.allowedAlgorithms`
 * @param {typeof fetch} [options.fetchFn]
 * @returns {{ fetchSigningKeys: (jwksUri: string) => Promise<Map<string, import('node:crypto').KeyObject | CryptoKey>> }}
 */
export function createJwksClient({
  timeoutMs,
  allowedAlgorithms,
  fetchFn = fetch
}) {
  async function fetchSigningKeys(jwksUri) {
    const document = await fetchBoundedJson({
      url: jwksUri,
      timeoutMs,
      maxBytes: MAX_JWKS_BYTES,
      fetchFn,
      unavailableReason: SigningKeyFailure.JWKS_UNAVAILABLE,
      invalidReason: SigningKeyFailure.JWKS_INVALID
    })

    if (!isUsableKeySet(document)) {
      throw new SigningKeyError(SigningKeyFailure.JWKS_INVALID)
    }
    assertUniqueKeyIds(document.keys)

    const candidates = document.keys.filter((jwk) =>
      isCandidateKey(jwk, allowedAlgorithms)
    )
    const imported = await Promise.all(
      candidates.map((jwk) => importPublicKey(jwk, allowedAlgorithms[0]))
    )

    const signingKeys = new Map()
    candidates.forEach((jwk, index) => {
      if (imported[index]) {
        signingKeys.set(jwk.kid, imported[index])
      }
    })

    if (signingKeys.size === 0) {
      throw new SigningKeyError(SigningKeyFailure.NO_USABLE_SIGNING_KEYS)
    }

    return signingKeys
  }

  return { fetchSigningKeys }
}
