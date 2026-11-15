import { fetchBoundedJson } from './bounded-json-fetch.js'
import { SigningKeyError, SigningKeyFailure } from './signing-key-failure.js'

const MAX_METADATA_BYTES = 64 * 1024

function parseJwksUri(value, { allowHttp }) {
  if (typeof value !== 'string' || value.length === 0) {
    return null
  }

  let url
  try {
    url = new URL(value)
  } catch {
    return null
  }

  const allowedProtocols = allowHttp ? ['https:', 'http:'] : ['https:']
  if (
    !allowedProtocols.includes(url.protocol) ||
    url.username ||
    url.password ||
    url.hash
  ) {
    return null
  }

  return url.href
}

/**
 * Retrieves the OpenID Connect discovery document from the single configured metadata URL and returns
 * the only two facts the service trusts from it: the exact issuer and the `jwks_uri`.
 *
 * @param {Object} options
 * @param {string} options.metadataUrl configured `entra.oidcMetadataUrl`
 * @param {string} options.expectedIssuer configured `entra.issuer`; the document must match it exactly
 * @param {number} options.timeoutMs
 * @param {boolean} [options.allowHttp] permits an http `jwks_uri` for local development only
 * @param {typeof fetch} [options.fetchFn]
 * @returns {{ fetchMetadata: () => Promise<Readonly<{ issuer: string, jwksUri: string }>> }}
 */
export function createOidcMetadataClient({
  metadataUrl,
  expectedIssuer,
  timeoutMs,
  allowHttp = false,
  fetchFn = fetch
}) {
  async function fetchMetadata() {
    const document = await fetchBoundedJson({
      url: metadataUrl,
      timeoutMs,
      maxBytes: MAX_METADATA_BYTES,
      fetchFn,
      unavailableReason: SigningKeyFailure.METADATA_UNAVAILABLE,
      invalidReason: SigningKeyFailure.METADATA_INVALID
    })

    if (
      document === null ||
      typeof document !== 'object' ||
      Array.isArray(document) ||
      typeof document.issuer !== 'string' ||
      document.issuer.length === 0
    ) {
      throw new SigningKeyError(SigningKeyFailure.METADATA_INVALID)
    }

    if (document.issuer !== expectedIssuer) {
      throw new SigningKeyError(SigningKeyFailure.METADATA_ISSUER_MISMATCH)
    }

    const jwksUri = parseJwksUri(document.jwks_uri, { allowHttp })
    if (!jwksUri) {
      throw new SigningKeyError(SigningKeyFailure.METADATA_INVALID)
    }

    return Object.freeze({ issuer: document.issuer, jwksUri })
  }

  return { fetchMetadata }
}
