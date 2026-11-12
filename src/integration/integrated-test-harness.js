import Hapi from '@hapi/hapi'
import { vi } from 'vitest'

import {
  signTestToken,
  TEST_AUDIENCE,
  TEST_ISSUER,
  TEST_JWKS_URI,
  TEST_METADATA_URL
} from '#/authentication/entra/entra-test-fixtures.js'
import { createSecurityTelemetry } from '#/authorization/security-telemetry.js'
import { failAction } from '#/common/helpers/fail-action.js'
import { capabilityAuthorizer } from '#/plugins/capability-authorizer.js'
import { capabilityEnforcement } from '#/plugins/capability-enforcement.js'
import { entraAuthentication } from '#/plugins/entra-authentication.js'
import { entraSigningKeys } from '#/plugins/entra-signing-keys.js'
import { errorMapping } from '#/plugins/error-mapping.js'
import { requestTracing } from '#/plugins/request-tracing.js'
import { roleDefinitionsCache } from '#/plugins/role-definitions-cache.js'
import { userProfile } from '#/plugins/user-profile-client.js'
import { userRoleCache } from '#/plugins/user-role-cache.js'
import { catchRecords } from '#/routes/catch-records.js'
import { vesselProfiles } from '#/routes/vessel-profiles.js'

export const TRACE_ID = 'trace-integration-1'
export const CLOCK_START_MS = Date.parse('2026-01-01T12:00:00Z')
export const USER_ROLE_TTL_SECONDS = 300
export const DEFINITIONS_TTL_SECONDS = 60
export const DEFINITIONS_MAXIMUM_STALE_SECONDS = 300
export const MINIMUM_REFRESH_SECONDS = 60

const HTTP_OK = 200
const MILLISECONDS_PER_SECOND = 1000
const HTTP_UNAVAILABLE = 503
const CAPABILITY_READ = 'catch-record.read'

const USER_ROLES_URL =
  'https://user-profile.test.invalid/users/{entraObjectId}/roles'
const DEFINITIONS_URL =
  'https://user-profile.test.invalid/roles-definitions/services/catch-recording'

export const ENTRA_CONFIG = Object.freeze({
  issuer: TEST_ISSUER,
  audience: TEST_AUDIENCE,
  oidcMetadataUrl: TEST_METADATA_URL,
  allowedAlgorithms: ['RS256'],
  userIdClaim: 'oid',
  metadataRefreshIntervalSeconds: 3600,
  minimumRefreshIntervalSeconds: MINIMUM_REFRESH_SECONDS,
  requestTimeoutMs: 1000
})

export const DEFAULT_DEFINITIONS = Object.freeze([
  {
    roleId: 'Owner',
    capabilityIds: [
      CAPABILITY_READ,
      'catch-record.create',
      'catch-record.update'
    ]
  },
  { roleId: 'Submitter', capabilityIds: ['catch-record.submit'] },
  {
    roleId: 'Skipper',
    capabilityIds: [CAPABILITY_READ, 'catch-record.amend']
  },
  { roleId: 'ReadOnlyUser', capabilityIds: [CAPABILITY_READ] }
])

const json = (body, status = HTTP_OK) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  })

export function createDeferred() {
  let release
  const promise = new Promise((resolve) => {
    release = resolve
  })
  return { promise, release }
}

function respondWithKeys(world) {
  return world.jwksMode === 'invalid'
    ? json({ keys: 'broken' })
    : json({ keys: world.keys })
}

async function respondWithDefinitions(world) {
  await world.definitionsGate?.promise
  if (world.definitionsMode === 'fail') {
    return json({}, HTTP_UNAVAILABLE)
  }

  return json({
    schemaVersion: '1.0',
    definitionsVersion: world.definitionsVersion,
    serviceId:
      world.definitionsMode === 'wrong-service'
        ? 'another-service'
        : 'catch-recording',
    roles: world.definitionsMode === 'empty' ? [] : world.definitions
  })
}

async function respondWithUserRoles(world, url) {
  await world.userRolesGate?.promise
  if (world.userRolesMode === 'fail') {
    return json({}, HTTP_UNAVAILABLE)
  }

  const userId = decodeURIComponent(
    url.split('/users/')[1].replace('/roles', '')
  )
  return json({
    schemaVersion: '1.0',
    definitionsVersion: '1',
    userId: world.userRolesMode === 'wrong-user' ? 'someone-else' : userId,
    roles: world.users[userId] ?? []
  })
}

/**
 * A controllable stand-in for everything outside the service: the OIDC metadata and JWKS endpoints and the
 * User Profile Service. It records every request (URL and headers) and can be switched into failure modes.
 */
export function createWorld({ signing }) {
  const world = {
    calls: [],
    keys: [signing.publicJwk],
    metadata: { issuer: TEST_ISSUER, jwks_uri: TEST_JWKS_URI },
    jwksMode: 'ok',
    users: {},
    userRolesMode: 'ok',
    userRolesGate: null,
    definitionsVersion: '1',
    definitions: DEFAULT_DEFINITIONS,
    definitionsMode: 'ok',
    definitionsGate: null,
    callsTo: (part) => world.calls.filter((call) => call.url.includes(part)),
    countOf: (part) => world.callsTo(part).length
  }

  world.fetch = async (url, options = {}) => {
    world.calls.push({ url, headers: { ...options.headers } })

    if (url === TEST_METADATA_URL) {
      return json(world.metadata)
    }
    if (url === TEST_JWKS_URI) {
      return respondWithKeys(world)
    }

    return url.includes('/roles-definitions/')
      ? respondWithDefinitions(world)
      : respondWithUserRoles(world, url)
  }

  return world
}

/** A database double that records every collection access and write and holds no catch records. */
export function createRecordingDb() {
  const writes = []
  const reads = []
  const collection = (name) => ({
    findOne: async () => {
      reads.push(name)
      return null
    },
    find: () => {
      reads.push(name)
      return {
        toArray: async () => [],
        sort() {
          return this
        },
        limit() {
          return this
        },
        project() {
          return this
        }
      }
    },
    ...Object.fromEntries(
      [
        'insertOne',
        'updateOne',
        'findOneAndUpdate',
        'deleteOne',
        'replaceOne'
      ].map((method) => [
        method,
        async () => {
          writes.push(`${name}.${method}`)
          return {
            acknowledged: true,
            matchedCount: 0,
            modifiedCount: 0,
            deletedCount: 0
          }
        }
      ])
    )
  })

  return { db: { collection }, writes, reads }
}

function pipelinePlugins({ world, monotonic, wallClock }) {
  return [
    {
      plugin: entraSigningKeys,
      options: { entra: ENTRA_CONFIG, fetchFn: world.fetch, now: monotonic }
    },
    {
      plugin: entraAuthentication,
      options: { entra: ENTRA_CONFIG, now: wallClock }
    },
    {
      plugin: userProfile,
      options: {
        userRolesUrlTemplate: USER_ROLES_URL,
        roleDefinitionsUrl: DEFINITIONS_URL,
        userProfileRequestTimeoutMs: 1000,
        userProfileRetryCount: 0,
        userProfileRetryDelayMs: 0,
        tracingHeader: 'x-cdp-request-id',
        fetchFn: world.fetch
      }
    },
    {
      plugin: userRoleCache,
      options: {
        ttlSeconds: USER_ROLE_TTL_SECONDS,
        maximumEntries: 100,
        now: monotonic
      }
    },
    {
      plugin: roleDefinitionsCache,
      options: {
        serviceId: 'catch-recording',
        ttlSeconds: DEFINITIONS_TTL_SECONDS,
        maximumStaleSeconds: DEFINITIONS_MAXIMUM_STALE_SECONDS,
        now: monotonic
      }
    },
    capabilityAuthorizer,
    capabilityEnforcement
  ]
}

function decorateRequestDoubles(server, persistence) {
  server.decorate('request', 'db', () => persistence.db, { apply: true })
  server.decorate(
    'request',
    'referenceDataClient',
    () => ({ getVesselById: vi.fn(), listVessels: vi.fn() }),
    { apply: true }
  )
  server.decorate(
    'request',
    'catchArtifactStore',
    () => ({ retrieveArtifact: vi.fn() }),
    { apply: true }
  )
}

function createCallers({ server, signing, wallClock }) {
  /** Signs a synthetic access token at the current simulated time. */
  const token = (claims = {}, options = {}) =>
    signTestToken(options.signing ?? signing, {
      now: wallClock(),
      claims,
      ...options
    })

  const call = (
    bearer,
    { method = 'GET', url = '/v1/catch-records', payload, headers = {} } = {}
  ) =>
    server.inject({
      method,
      url,
      payload,
      headers: {
        ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
        'x-cdp-request-id': TRACE_ID,
        ...headers
      }
    })

  return { token, call }
}

/**
 * Builds the real authentication and authorization pipeline - Entra token validation, signing-key provider,
 * User Profile Service client, both caches, capability engine, enforcement, error mapping, telemetry and the
 * real Catch Recording routes - with only the outside world, the clock and persistence replaced.
 */
export async function createIntegratedServer({ world, signing }) {
  const clock = { ms: 0 }
  const monotonic = () => clock.ms
  const wallClock = () => new Date(CLOCK_START_MS + clock.ms)
  const advanceSeconds = (seconds) => {
    clock.ms += seconds * MILLISECONDS_PER_SECOND
  }

  const logs = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  const metrics = {
    counter: vi.fn(async () => {}),
    millis: vi.fn(async () => {})
  }
  const persistence = createRecordingDb()

  const server = Hapi.server({
    routes: { validate: { options: { abortEarly: false }, failAction } }
  })
  server.decorate(
    'server',
    'securityTelemetry',
    createSecurityTelemetry({ logger: logs, metrics })
  )
  await server.register([requestTracing, errorMapping])
  await server.register(pipelinePlugins({ world, monotonic, wallClock }))
  decorateRequestDoubles(server, persistence)
  server.route([...catchRecords, ...vesselProfiles])
  await server.initialize()

  const { token, call } = createCallers({ server, signing, wallClock })

  return {
    server,
    clock,
    advanceSeconds,
    token,
    call,
    logs,
    metrics,
    persistence,
    wallClock
  }
}

export { createTestSigningKey } from '#/authentication/entra/entra-test-fixtures.js'
