import { generateKeyPairSync } from 'node:crypto'

import { exportJWK } from 'jose'

export const TEST_ISSUER = 'https://login.entra.test.invalid/test-tenant/v2.0'
export const TEST_METADATA_URL = `${TEST_ISSUER}/.well-known/openid-configuration`
export const TEST_JWKS_URI = 'https://login.entra.test.invalid/test-tenant/keys'

/**
 * Generates a throwaway RSA signing key pair for tests only. The private key never leaves the test
 * process and nothing here is, or resembles, a real Entra key.
 */
export async function createTestSigningKey(
  keyId,
  { modulusLength = 2048 } = {}
) {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength
  })
  const publicJwk = { ...(await exportJWK(publicKey)), kid: keyId, use: 'sig' }

  return { keyId, publicKey, privateKey, publicJwk }
}

/**
 * Deterministic in-memory `fetch` replacement. `routes` maps an exact URL to a handler returning
 * `{ status?, json?, text?, headers?, hang? }`; `hang` never settles until the request is aborted.
 * Every call is recorded so tests can assert the exact number of network requests.
 */
export function createFetchStub(routes) {
  const calls = []

  async function fetchStub(url, options = {}) {
    calls.push({ url, options })
    const route = routes[url]
    if (!route) {
      throw new TypeError('fetch failed')
    }

    const result = typeof route === 'function' ? await route() : route
    if (result.hang) {
      await new Promise((resolve, reject) => {
        options.signal?.addEventListener('abort', () =>
          reject(new DOMException('aborted', 'AbortError'))
        )
      })
    }
    if (result.error) {
      throw result.error
    }

    const body = result.text ?? JSON.stringify(result.json ?? {})
    return new Response(body, {
      status: result.status ?? 200,
      headers: result.headers
    })
  }

  fetchStub.calls = calls
  fetchStub.countFor = (url) => calls.filter((call) => call.url === url).length

  return fetchStub
}
