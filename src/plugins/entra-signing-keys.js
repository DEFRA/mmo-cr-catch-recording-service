import { createJwksClient } from '#/authentication/entra/jwks-client.js'
import { createOidcMetadataClient } from '#/authentication/entra/oidc-metadata-client.js'
import { createSigningKeyProvider } from '#/authentication/entra/signing-key-provider.js'

const hasEntraConfiguration = (entra) =>
  Boolean(entra.issuer && entra.oidcMetadataUrl)

/**
 * Builds the single shared Entra signing-key provider from validated configuration. Returns `null` when
 * the (local-development only) configuration is entirely unset, so no signing key can ever be resolved.
 */
export function createEntraSigningKeyProvider({
  entra,
  allowHttp = false,
  fetchFn = fetch,
  now,
  logger
}) {
  if (!hasEntraConfiguration(entra)) {
    return null
  }

  return createSigningKeyProvider({
    metadataClient: createOidcMetadataClient({
      metadataUrl: entra.oidcMetadataUrl,
      expectedIssuer: entra.issuer,
      timeoutMs: entra.requestTimeoutMs,
      allowHttp,
      fetchFn
    }),
    jwksClient: createJwksClient({
      timeoutMs: entra.requestTimeoutMs,
      allowedAlgorithms: entra.allowedAlgorithms,
      fetchFn
    }),
    refreshIntervalSeconds: entra.metadataRefreshIntervalSeconds,
    minimumRefreshIntervalSeconds: entra.minimumRefreshIntervalSeconds,
    now,
    logger
  })
}

/**
 * Decorates the server with `entraSigningKeyProvider`: one shared, lazily-loaded signing-key provider
 * (or `null` when Entra is not configured). Loading is on first use, so `/health` and public routes never
 * depend on Entra availability. Nothing validates tokens through it yet.
 */
export const entraSigningKeys = {
  plugin: {
    name: 'entra-signing-keys',
    once: true,
    register: (server, options) => {
      server.decorate(
        'server',
        'entraSigningKeyProvider',
        createEntraSigningKeyProvider({ ...options, logger: server.logger })
      )
    }
  }
}
