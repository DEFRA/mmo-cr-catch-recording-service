import { vi } from 'vitest'

import { entraAuthenticationScheme } from '#/authentication/entra/entra-authentication-scheme.js'
import { ENTRA_AUTH_STRATEGY } from '#/authentication/entra/entra-auth-strategy.js'
import { capabilityEnforcement } from '#/plugins/capability-enforcement.js'
import { AuthorizationOutcome } from './capability-authorizer.js'

/** Synthetic test tokens and the stable identifier each one authenticates as. */
export const TEST_ACTORS = Object.freeze({
  'token-1': 'owner-1',
  'test-token-1': 'owner-1',
  'test-actor-token': 'owner-1',
  'other-owner-token': 'a-different-owner'
})

/**
 * A test double for the Step 03 access-token validator: it accepts only the synthetic tokens in
 * `actors` and rejects every other string (so a fixed legacy token never authenticates).
 */
export function createStubValidator(actors = TEST_ACTORS) {
  return {
    validate: async (authorizationHeader) => {
      const token =
        typeof authorizationHeader === 'string'
          ? authorizationHeader.replace(/^Bearer /, '')
          : null

      return Object.hasOwn(actors, token)
        ? { ok: true, claims: Object.freeze({ oid: actors[token] }) }
        : { ok: false, reason: 'INVALID_TOKEN', source: 'credentials' }
    }
  }
}

export const allowedDecision = Object.freeze({
  outcome: AuthorizationOutcome.ALLOWED,
  grantedVesselIds: Object.freeze([])
})

/**
 * Registers, on a test server, the real Entra authentication scheme (with a stub validator), a stub
 * capability authorizer and the real capability-enforcement plugin, mirroring the production wiring so
 * protected routes are exercised through their real authentication and enforcement boundary.
 *
 * @param {import('@hapi/hapi').Server} server
 * @param {{ actors?: object, authorize?: Function, authorizerAvailable?: boolean }} [options] `authorize`
 *   stands in for the capability engine and defaults to allowing every request; `authorizerAvailable:
 *   false` models an unconfigured authorizer
 * @returns {Promise<{ authorize: import('vitest').Mock }>}
 */
export async function registerStubAuthorization(
  server,
  { actors = TEST_ACTORS, authorize, authorizerAvailable = true } = {}
) {
  const authorizeMock = vi.fn(authorize ?? (async () => allowedDecision))

  await server.register([
    {
      plugin: {
        name: 'entra-authentication',
        register: (instance) => {
          instance.auth.scheme(ENTRA_AUTH_STRATEGY, entraAuthenticationScheme)
          instance.auth.strategy(ENTRA_AUTH_STRATEGY, ENTRA_AUTH_STRATEGY, {
            validator: createStubValidator(actors),
            userIdClaim: 'oid'
          })
        }
      }
    },
    {
      plugin: {
        name: 'capability-authorizer',
        register: (instance) => {
          instance.decorate(
            'server',
            'capabilityAuthorizer',
            authorizerAvailable ? { authorize: authorizeMock } : null
          )
        }
      }
    },
    capabilityEnforcement
  ])

  return { authorize: authorizeMock }
}
