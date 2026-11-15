import { createAuthenticatedUserContext } from '#/authentication/entra/authenticated-user-context.js'
import { createSigningKeyProvider } from '#/authentication/entra/signing-key-provider.js'
import {
  SigningKeyError,
  SigningKeyFailure
} from '#/authentication/entra/signing-key-failure.js'
import { createCapabilityAuthorizer } from './capability-authorizer.js'
import { createRoleDefinitionsCache } from './role-definitions-cache.js'
import { createSecurityTelemetry } from './security-telemetry.js'
import { createUserProfileClient } from './user-profile-client.js'
import { createUserRoleCache } from './user-role-cache.js'
import { createRequiredCapability } from './capability-authorizer.js'

const USER_ID = 'user-sensitive-id-9'
const SECRET_ROLE = 'VRO5--Owner'
const CORRELATION = 'trace-observed-1'
const user = createAuthenticatedUserContext({ oid: USER_ID }, 'oid').user

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  })

function build({ failRoles = false } = {}) {
  const logs = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  const metrics = {
    counter: vi.fn(async () => {}),
    millis: vi.fn(async () => {})
  }
  const telemetry = createSecurityTelemetry({ logger: logs, metrics })
  const fetchFn = vi.fn(async (url) =>
    url.includes('/roles-definitions/')
      ? json({
          schemaVersion: '1.0',
          definitionsVersion: '3',
          serviceId: 'catch-recording',
          roles: [{ roleId: 'Owner', capabilityIds: ['catch-record.read'] }]
        })
      : failRoles
        ? json({}, 503)
        : json({
            schemaVersion: '1.0',
            definitionsVersion: '3',
            userId: USER_ID,
            roles: [SECRET_ROLE]
          })
  )
  const userProfileClient = createUserProfileClient({
    userRolesUrlTemplate:
      'https://user-profile.test.invalid/users/{entraObjectId}/roles',
    roleDefinitionsUrl:
      'https://user-profile.test.invalid/roles-definitions/services/catch-recording',
    userProfileRequestTimeoutMs: 1000,
    userProfileRetryCount: 0,
    fetchFn,
    logger: telemetry
  })
  const authorizer = createCapabilityAuthorizer({
    userRoleCache: createUserRoleCache({
      userProfileClient,
      ttlSeconds: 300,
      maximumEntries: 10,
      logger: telemetry
    }),
    roleDefinitionsCache: createRoleDefinitionsCache({
      userProfileClient,
      serviceId: 'catch-recording',
      ttlSeconds: 60,
      maximumStaleSeconds: 300,
      logger: telemetry
    }),
    logger: telemetry
  })

  return { authorizer, logs, metrics, fetchFn }
}

const allLogs = (logs) =>
  JSON.stringify(Object.values(logs).flatMap((fn) => fn.mock.calls))
const counterNames = (metrics) =>
  metrics.counter.mock.calls.map(([name]) => name)

describe('security observability across the authorization flow', () => {
  test('Should emit bounded signals for a full authorized request and propagate the correlation id', async () => {
    const { authorizer, logs, metrics, fetchFn } = build()

    const decision = await authorizer.authorize(
      user,
      createRequiredCapability('catch-record.read'),
      { correlationId: CORRELATION }
    )

    expect(decision.outcome).toBe('allowed')
    expect(counterNames(metrics)).toEqual(
      expect.arrayContaining([
        'authUserRoleCacheEvents',
        'authRoleDefinitionsCacheEvents',
        'authUserProfileRequests',
        'authDecisions'
      ])
    )
    expect(metrics.millis).toHaveBeenCalledWith(
      'authUserProfileRequestMs',
      expect.any(Number),
      { operation: 'user-roles', outcome: 'SUCCESS' }
    )
    expect(metrics.millis).toHaveBeenCalledWith(
      'authDecisionMs',
      expect.any(Number),
      { outcome: 'allowed', reason: 'granted' }
    )
    for (const [, options] of fetchFn.mock.calls) {
      expect(options.headers['x-cdp-request-id']).toBe(CORRELATION)
    }
    expect(allLogs(logs)).toContain(CORRELATION)
  })

  test('Should never leak identity, roles, URLs, definitions or bodies into any log or metric', async () => {
    const { authorizer, logs, metrics } = build()

    await authorizer.authorize(
      user,
      createRequiredCapability('catch-record.read'),
      {
        correlationId: CORRELATION
      }
    )
    await authorizer.authorize(
      user,
      createRequiredCapability('catch-record.amend'),
      {
        correlationId: CORRELATION
      }
    )

    const everything =
      allLogs(logs) +
      JSON.stringify([
        ...metrics.counter.mock.calls,
        ...metrics.millis.mock.calls
      ])
    expect(everything).not.toMatch(
      /user-sensitive-id|VRO5|Owner|user-profile\.test\.invalid|roles-definitions|schemaVersion|secret/i
    )
  })

  test('Should surface a user-role dependency failure as a warning and an authorization-unavailable decision', async () => {
    const { authorizer, logs, metrics } = build({ failRoles: true })

    const decision = await authorizer.authorize(
      user,
      createRequiredCapability('catch-record.read'),
      { correlationId: CORRELATION }
    )

    expect(decision.outcome).toBe('unavailable')
    expect(logs.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'user-profile.request',
        outcome: 'UNAVAILABLE'
      }),
      expect.any(String)
    )
    expect(logs.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'authorization.decision',
        outcome: 'unavailable',
        reason: 'USER_ROLES_UNAVAILABLE'
      }),
      expect.any(String)
    )
    expect(metrics.counter).toHaveBeenCalledWith('authDecisions', 1, {
      outcome: 'unavailable',
      reason: 'USER_ROLES_UNAVAILABLE'
    })
  })

  test('Should keep the same decisions when every telemetry sink fails', async () => {
    const down = () => {
      throw new Error('sink down')
    }
    const telemetry = createSecurityTelemetry({
      logger: { debug: down, info: down, warn: down },
      metrics: { counter: down, millis: down }
    })
    const client = createUserProfileClient({
      userRolesUrlTemplate:
        'https://u.test.invalid/users/{entraObjectId}/roles',
      roleDefinitionsUrl:
        'https://u.test.invalid/roles-definitions/services/catch-recording',
      userProfileRequestTimeoutMs: 1000,
      fetchFn: async (url) =>
        url.includes('/roles-definitions/')
          ? json({
              schemaVersion: '1.0',
              definitionsVersion: '3',
              serviceId: 'catch-recording',
              roles: [{ roleId: 'Owner', capabilityIds: ['catch-record.read'] }]
            })
          : json({
              schemaVersion: '1.0',
              definitionsVersion: '3',
              userId: USER_ID,
              roles: [SECRET_ROLE]
            }),
      logger: telemetry
    })
    const authorizer = createCapabilityAuthorizer({
      userRoleCache: createUserRoleCache({
        userProfileClient: client,
        ttlSeconds: 300,
        maximumEntries: 5,
        logger: telemetry
      }),
      roleDefinitionsCache: createRoleDefinitionsCache({
        userProfileClient: client,
        serviceId: 'catch-recording',
        ttlSeconds: 60,
        maximumStaleSeconds: 300,
        logger: telemetry
      }),
      logger: telemetry
    })

    const allowed = await authorizer.authorize(
      user,
      createRequiredCapability('catch-record.read')
    )
    const denied = await authorizer.authorize(
      user,
      createRequiredCapability('catch-record.create')
    )

    expect([allowed.outcome, denied.outcome]).toEqual(['allowed', 'denied'])
  })

  test('Should emit refresh, unknown-key and throttle signals for the signing-key provider without key identifiers', async () => {
    const logs = { debug: vi.fn(), info: vi.fn(), warn: vi.fn() }
    const metrics = {
      counter: vi.fn(async () => {}),
      millis: vi.fn(async () => {})
    }
    const clock = { time: 0 }
    const provider = createSigningKeyProvider({
      metadataClient: {
        fetchMetadata: async () => ({ issuer: 'i', jwksUri: 'j' })
      },
      jwksClient: {
        fetchSigningKeys: async () => new Map([['kid-secret-1', 'key']])
      },
      refreshIntervalSeconds: 3600,
      minimumRefreshIntervalSeconds: 60,
      now: () => clock.time,
      logger: createSecurityTelemetry({ logger: logs, metrics })
    })

    await provider.getSigningKey('kid-secret-1')
    clock.time += 60_000
    await provider.getSigningKey('kid-unknown-2')
    await provider.getSigningKey('kid-unknown-3')

    expect(metrics.counter).toHaveBeenCalledWith('authSigningKeyRefreshes', 1, {
      outcome: 'success'
    })
    expect(metrics.counter).toHaveBeenCalledWith('authSigningKeyLookups', 1, {
      outcome: 'unknown-kid',
      reason: 'key-not-found'
    })
    expect(metrics.counter).toHaveBeenCalledWith('authSigningKeyLookups', 1, {
      outcome: 'throttled',
      reason: 'refresh-throttled'
    })
    expect(allLogs(logs)).not.toMatch(/kid-secret|kid-unknown/)
  })

  test('Should report a failed signing-key refresh with its bounded reason', async () => {
    const logs = { debug: vi.fn(), info: vi.fn(), warn: vi.fn() }
    const metrics = {
      counter: vi.fn(async () => {}),
      millis: vi.fn(async () => {})
    }
    const provider = createSigningKeyProvider({
      metadataClient: {
        fetchMetadata: async () => {
          throw new SigningKeyError(SigningKeyFailure.METADATA_UNAVAILABLE)
        }
      },
      jwksClient: { fetchSigningKeys: async () => new Map() },
      refreshIntervalSeconds: 3600,
      minimumRefreshIntervalSeconds: 60,
      logger: createSecurityTelemetry({ logger: logs, metrics })
    })

    await provider.getSigningKey('any')

    expect(metrics.counter).toHaveBeenCalledWith('authSigningKeyRefreshes', 1, {
      outcome: 'failure',
      reason: 'METADATA_UNAVAILABLE'
    })
    expect(metrics.millis).toHaveBeenCalledWith(
      'authSigningKeyRefreshMs',
      expect.any(Number),
      {
        outcome: 'failure',
        reason: 'METADATA_UNAVAILABLE'
      }
    )
  })
})
