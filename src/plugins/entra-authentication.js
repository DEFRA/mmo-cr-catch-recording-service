import { createAccessTokenValidator } from '#/authentication/entra/access-token-validator.js'
import { entraAuthenticationScheme } from '#/authentication/entra/entra-authentication-scheme.js'

export const ENTRA_AUTH_STRATEGY = 'entra-bearer'

/**
 * Registers the `entra-bearer` Hapi authentication strategy, validating Entra access tokens locally
 * with the shared signing-key provider (`server.entraSigningKeyProvider`). Dormant: no route opts in yet.
 * When Entra is not configured (local development only) every token is rejected - it never falls back
 * to any other form of authentication.
 */
export const entraAuthentication = {
  plugin: {
    name: 'entra-authentication',
    once: true,
    dependencies: ['entra-signing-keys'],
    register: (server, options) => {
      const { entra, now } = options
      const validator = createAccessTokenValidator({
        signingKeyProvider: server.entraSigningKeyProvider,
        issuer: entra.issuer,
        audience: entra.audience,
        allowedAlgorithms: entra.allowedAlgorithms,
        now
      })

      server.auth.scheme(ENTRA_AUTH_STRATEGY, entraAuthenticationScheme)
      server.auth.strategy(ENTRA_AUTH_STRATEGY, ENTRA_AUTH_STRATEGY, {
        validator
      })
    }
  }
}
