import { vi } from 'vitest'

import { createAuthenticatedUserContext } from '#/authentication/entra/authenticated-user-context.js'
import {
  createUserProfileClient,
  UserProfileOutcome
} from './user-profile-client.js'

const ROLES_TEMPLATE =
  'https://user-profile.test.invalid/users/{entraObjectId}/roles'
const DEFINITIONS_URL =
  'https://user-profile.test.invalid/roles-definitions/services/catch-recording'
const USER_ID = '00000000-0000-4000-8000-000000000001'
const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' }
const TOKEN = 'secret-access-token-value'

const trustedUser = (userId = USER_ID) =>
  createAuthenticatedUserContext({ oid: userId }, 'oid').user

const jsonResponse = (body, init = {}) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: JSON_HEADERS,
    ...init
  })

function createHarness({ responses, ...overrides } = {}) {
  const queue = [...responses]
  const fetchFn = vi.fn(async (url, options) => {
    const next = queue.length > 1 ? queue.shift() : queue[0]
    if (typeof next === 'function') {
      return next(url, options)
    }
    if (next instanceof Error) {
      throw next
    }
    return next
  })
  const logger = { debug: vi.fn(), warn: vi.fn() }
  const sleepFn = vi.fn(async () => {})
  const client = createUserProfileClient({
    userRolesUrlTemplate: ROLES_TEMPLATE,
    roleDefinitionsUrl: DEFINITIONS_URL,
    userProfileRequestTimeoutMs: 1000,
    userProfileRetryCount: 1,
    userProfileRetryDelayMs: 25,
    fetchFn,
    logger,
    sleepFn,
    ...overrides
  })

  return { client, fetchFn, logger, sleepFn }
}

describe('#createUserProfileClient', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  describe('request construction', () => {
    test('Should request the user roles for the trusted user from the configured origin only', async () => {
      const { client, fetchFn } = createHarness({
        responses: [jsonResponse({ roles: [] })]
      })

      await client.getUserRoles(trustedUser(), { correlationId: 'corr-1' })

      const [url, options] = fetchFn.mock.calls[0]
      expect(url).toBe(
        `https://user-profile.test.invalid/users/${USER_ID}/roles`
      )
      expect(options).toMatchObject({ method: 'GET', redirect: 'error' })
    })

    test.each([
      [null],
      [undefined],
      [{ userId: USER_ID }],
      ['a-user-id'],
      [{}]
    ])(
      'Should refuse to build a request for the untrusted user %j',
      async (user) => {
        const { client, fetchFn } = createHarness({
          responses: [jsonResponse({})]
        })

        await expect(client.getUserRoles(user)).resolves.toMatchObject({
          ok: false,
          outcome: UserProfileOutcome.INTERNAL_ERROR
        })
        expect(fetchFn).not.toHaveBeenCalled()
      }
    )

    test('Should request the role definitions from the configured URL', async () => {
      const { client, fetchFn } = createHarness({
        responses: [jsonResponse({ roles: [] })]
      })

      await client.getRoleDefinitions()

      expect(fetchFn.mock.calls[0][0]).toBe(DEFINITIONS_URL)
    })

    test('Should send only standard headers, never a credential or the access token', async () => {
      const { client, fetchFn } = createHarness({
        responses: [jsonResponse({})]
      })

      await client.getUserRoles(trustedUser(), { correlationId: 'corr-1' })
      await client.getRoleDefinitions({ correlationId: 'corr-2' })

      for (const [url, options] of fetchFn.mock.calls) {
        expect(Object.keys(options.headers).sort()).toEqual([
          'Accept',
          'x-cdp-request-id'
        ])
        expect(JSON.stringify([url, options])).not.toContain(TOKEN)
      }
    })

    test.each([['corr-1'], ['0b8e2c4a-7d41-4c0e-9f55-6f8f0f1c1a11']])(
      'Should propagate the correlation id %s in the configured tracing header',
      async (correlationId) => {
        const { client, fetchFn } = createHarness({
          responses: [jsonResponse({})],
          tracingHeader: 'x-trace'
        })

        await client.getRoleDefinitions({ correlationId })

        expect(fetchFn.mock.calls[0][1].headers['x-trace']).toBe(correlationId)
      }
    )

    test.each([
      [undefined],
      [''],
      ['bad value\r\nx-evil: 1'],
      ['a'.repeat(200)],
      [42]
    ])(
      'Should not propagate the unsafe correlation id %j',
      async (correlationId) => {
        const { client, fetchFn } = createHarness({
          responses: [jsonResponse({})]
        })

        await client.getRoleDefinitions({ correlationId })

        expect(fetchFn.mock.calls[0][1].headers).not.toHaveProperty(
          'x-cdp-request-id'
        )
      }
    )
  })

  describe('successful responses', () => {
    test('Should return the parsed body as an untrusted, deeply frozen transport object', async () => {
      const body = { schemaVersion: '1.0', userId: USER_ID, roles: ['A'] }
      const { client } = createHarness({ responses: [jsonResponse(body)] })

      const result = await client.getUserRoles(trustedUser())

      expect(result).toEqual({ ok: true, body })
      expect(Object.isFrozen(result.body)).toBe(true)
      expect(Object.isFrozen(result.body.roles)).toBe(true)
    })

    test('Should not interpret a syntactically valid but semantically odd body', async () => {
      const { client } = createHarness({ responses: [jsonResponse([])] })

      await expect(client.getRoleDefinitions()).resolves.toEqual({
        ok: true,
        body: []
      })
    })
  })

  describe('status handling', () => {
    test.each([
      [404, UserProfileOutcome.NOT_FOUND],
      [429, UserProfileOutcome.RATE_LIMITED],
      [400, UserProfileOutcome.CLIENT_ERROR],
      [403, UserProfileOutcome.CLIENT_ERROR],
      [500, UserProfileOutcome.SERVER_ERROR],
      [501, UserProfileOutcome.SERVER_ERROR],
      [503, UserProfileOutcome.UNAVAILABLE],
      [204, UserProfileOutcome.UNEXPECTED_STATUS],
      [302, UserProfileOutcome.UNEXPECTED_STATUS]
    ])(
      'Should report HTTP %i as %s without retrying non-transient statuses',
      async (status, outcome) => {
        const { client, fetchFn } = createHarness({
          responses: [
            new Response(status === 204 ? null : '{}', {
              status,
              headers: JSON_HEADERS
            })
          ],
          userProfileRetryCount: 0
        })

        await expect(client.getRoleDefinitions()).resolves.toEqual({
          ok: false,
          outcome,
          status
        })
        expect(fetchFn).toHaveBeenCalledTimes(1)
      }
    )

    test('Should report a non-JSON content type without parsing the body', async () => {
      const { client } = createHarness({
        responses: [
          new Response('<html>', {
            status: 200,
            headers: { 'content-type': 'text/html' }
          })
        ]
      })

      await expect(client.getRoleDefinitions()).resolves.toMatchObject({
        outcome: UserProfileOutcome.UNEXPECTED_CONTENT_TYPE
      })
    })

    test('Should report a missing content type as unexpected', async () => {
      const response = new Response('{}', { status: 200 })
      response.headers.delete('content-type')
      const { client } = createHarness({ responses: [response] })

      await expect(client.getRoleDefinitions()).resolves.toMatchObject({
        outcome: UserProfileOutcome.UNEXPECTED_CONTENT_TYPE
      })
    })

    test.each([
      ['unparsable JSON', new Response('{nope', { headers: JSON_HEADERS })],
      [
        'an oversized body',
        new Response(JSON.stringify({ a: 'x'.repeat(300 * 1024) }), {
          headers: JSON_HEADERS
        })
      ]
    ])(
      'Should report %s as invalid JSON and never as an empty success',
      async (_name, response) => {
        const { client } = createHarness({ responses: [response] })

        await expect(client.getRoleDefinitions()).resolves.toEqual({
          ok: false,
          outcome: UserProfileOutcome.INVALID_JSON,
          status: null
        })
      }
    )

    test('Should report a transport failure without leaking its cause', async () => {
      const { client } = createHarness({
        responses: [new TypeError('connect ECONNREFUSED 10.0.0.1:443')]
      })

      const result = await client.getRoleDefinitions()

      expect(result).toEqual({
        ok: false,
        outcome: UserProfileOutcome.TRANSPORT_FAILURE,
        status: null
      })
    })
  })

  describe('timeout and cancellation', () => {
    const hangingFetch = (_url, options) =>
      new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () =>
          reject(new DOMException('aborted', 'AbortError'))
        )
      })

    test('Should report a timeout when the dependency does not answer in time', async () => {
      vi.useFakeTimers()
      const { client } = createHarness({
        responses: [hangingFetch],
        userProfileRequestTimeoutMs: 50
      })

      const pending = client.getRoleDefinitions()
      await vi.advanceTimersByTimeAsync(51)

      await expect(pending).resolves.toMatchObject({
        outcome: UserProfileOutcome.TIMEOUT
      })
    })

    test('Should distinguish caller cancellation from a timeout', async () => {
      const { client } = createHarness({ responses: [hangingFetch] })
      const controller = new AbortController()

      const pending = client.getUserRoles(trustedUser(), {
        signal: controller.signal
      })
      controller.abort()

      await expect(pending).resolves.toMatchObject({
        outcome: UserProfileOutcome.CANCELLED
      })
    })

    test('Should not send a request for an already-cancelled caller', async () => {
      const { client, fetchFn } = createHarness({
        responses: [jsonResponse({})]
      })

      await expect(
        client.getRoleDefinitions({ signal: AbortSignal.abort() })
      ).resolves.toMatchObject({ outcome: UserProfileOutcome.CANCELLED })
      expect(fetchFn).not.toHaveBeenCalled()
    })

    test('Should stop retrying when the caller cancels during the retry delay', async () => {
      const controller = new AbortController()
      const { client, fetchFn } = createHarness({
        responses: [new Response('{}', { status: 503 })],
        sleepFn: async () => controller.abort()
      })

      await expect(
        client.getRoleDefinitions({ signal: controller.signal })
      ).resolves.toMatchObject({ outcome: UserProfileOutcome.CANCELLED })
      expect(fetchFn).toHaveBeenCalledTimes(1)
    })
  })

  describe('retry policy', () => {
    test.each([[502], [503], [504]])(
      'Should retry a transient HTTP %i once and return the later success',
      async (status) => {
        const { client, fetchFn, sleepFn } = createHarness({
          responses: [new Response('{}', { status }), jsonResponse({ ok: 1 })]
        })

        await expect(client.getRoleDefinitions()).resolves.toMatchObject({
          ok: true
        })
        expect(fetchFn).toHaveBeenCalledTimes(2)
        expect(sleepFn).toHaveBeenCalledWith(25, undefined)
      }
    )

    test('Should stay bounded by the configured retry count', async () => {
      const { client, fetchFn } = createHarness({
        responses: [new Response('{}', { status: 503 })],
        userProfileRetryCount: 2
      })

      await expect(client.getRoleDefinitions()).resolves.toMatchObject({
        outcome: UserProfileOutcome.UNAVAILABLE
      })
      expect(fetchFn).toHaveBeenCalledTimes(3)
    })

    test.each([
      ['a timeout', () => Promise.reject(new Error('x'))],
      ['invalid JSON', () => new Response('{nope', { headers: JSON_HEADERS })],
      ['a not-found', () => new Response('{}', { status: 404 })]
    ])('Should not retry %s', async (_name, response) => {
      const { client, fetchFn } = createHarness({
        responses: [response]
      })

      await client.getRoleDefinitions()

      expect(fetchFn).toHaveBeenCalledTimes(1)
    })

    test('Should not retry when retries are disabled', async () => {
      const { client, fetchFn } = createHarness({
        responses: [new Response('{}', { status: 503 })],
        userProfileRetryCount: 0
      })

      await client.getRoleDefinitions()

      expect(fetchFn).toHaveBeenCalledTimes(1)
    })

    test('Should wait using the real timer between retries by default', async () => {
      vi.useFakeTimers()
      const fetchFn = vi
        .fn()
        .mockResolvedValueOnce(new Response('{}', { status: 503 }))
        .mockResolvedValueOnce(jsonResponse({}))
      const client = createUserProfileClient({
        userRolesUrlTemplate: ROLES_TEMPLATE,
        roleDefinitionsUrl: DEFINITIONS_URL,
        userProfileRequestTimeoutMs: 1000,
        userProfileRetryCount: 1,
        userProfileRetryDelayMs: 100,
        fetchFn
      })

      const pending = client.getRoleDefinitions()
      await vi.advanceTimersByTimeAsync(0)
      expect(fetchFn).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(100)

      await expect(pending).resolves.toMatchObject({ ok: true })
    })

    test('Should abort the default retry wait when the caller cancels', async () => {
      vi.useFakeTimers()
      const controller = new AbortController()
      const fetchFn = vi.fn(async () => new Response('{}', { status: 503 }))
      const client = createUserProfileClient({
        userRolesUrlTemplate: ROLES_TEMPLATE,
        roleDefinitionsUrl: DEFINITIONS_URL,
        userProfileRequestTimeoutMs: 1000,
        userProfileRetryCount: 1,
        userProfileRetryDelayMs: 60_000,
        fetchFn
      })

      const pending = client.getRoleDefinitions({ signal: controller.signal })
      await vi.advanceTimersByTimeAsync(0)
      controller.abort()

      await expect(pending).resolves.toMatchObject({
        outcome: UserProfileOutcome.CANCELLED
      })
    })
  })

  describe('logging and privacy', () => {
    test('Should log safe operation outcomes without identifiers, URLs, bodies or tokens', async () => {
      const { client, logger } = createHarness({
        responses: [
          jsonResponse({ roles: ['Secret-Role'], userId: USER_ID }),
          new Response('{}', { status: 404 })
        ]
      })

      await client.getUserRoles(trustedUser(), { correlationId: 'corr-1' })
      await client.getUserRoles(trustedUser())

      const logged = JSON.stringify([
        ...logger.debug.mock.calls,
        ...logger.warn.mock.calls
      ])
      expect(logged).toContain('user-roles')
      expect(logged).toContain('NOT_FOUND')
      expect(logged).not.toContain(USER_ID)
      expect(logged).not.toContain('Secret-Role')
      expect(logged).not.toContain('user-profile.test.invalid')
    })

    test('Should work without a logger', async () => {
      const { client } = createHarness({
        responses: [jsonResponse({})],
        logger: undefined
      })

      await expect(client.getRoleDefinitions()).resolves.toMatchObject({
        ok: true
      })
    })
  })
})
