import { vi } from 'vitest'

import { createAuthenticatedUserContext } from '#/authentication/entra/authenticated-user-context.js'
import { AuthorizationDataFailure } from './authorization-response-validator.js'
import { UserProfileOutcome } from './user-profile-client.js'
import {
  createUserRoleCache,
  UserRoleCacheFailure,
  UserRoleCacheState
} from './user-role-cache.js'

const TTL_SECONDS = 300
const TTL_MS = TTL_SECONDS * 1000
const userFor = (userId) =>
  createAuthenticatedUserContext({ oid: userId }, 'oid').user
const rolesFor = (userId, roles) => ({
  ok: true,
  body: { schemaVersion: '1.0', definitionsVersion: '1', userId, roles }
})
const deferred = () => {
  let release
  const promise = new Promise((resolve) => {
    release = resolve
  })
  return { promise, resolve: release }
}

function createHarness({ maximumEntries = 10, responder } = {}) {
  const clock = { time: 1000 }
  const userProfileClient = {
    getUserRoles: vi.fn(
      responder ?? (async (user) => rolesFor(user.userId, ['Owner']))
    )
  }
  const logger = { debug: vi.fn(), warn: vi.fn() }
  const cache = createUserRoleCache({
    userProfileClient,
    ttlSeconds: TTL_SECONDS,
    maximumEntries,
    now: () => clock.time,
    logger
  })

  return { cache, userProfileClient, logger, clock }
}

describe('#createUserRoleCache', () => {
  describe('freshness and TTL', () => {
    test('Should fetch on a miss, cache the validated model and then serve hits without a request', async () => {
      const { cache, userProfileClient } = createHarness()
      const user = userFor('user-a')

      const first = await cache.getUserRoles(user, { correlationId: 'corr-1' })
      const second = await cache.getUserRoles(user)

      expect(first).toMatchObject({
        ok: true,
        cacheState: UserRoleCacheState.REFRESHED
      })
      expect(second).toMatchObject({
        ok: true,
        cacheState: UserRoleCacheState.HIT
      })
      expect(second.value).toBe(first.value)
      expect(Object.isFrozen(second.value)).toBe(true)
      expect(userProfileClient.getUserRoles).toHaveBeenCalledTimes(1)
      expect(userProfileClient.getUserRoles).toHaveBeenCalledWith(user, {
        correlationId: 'corr-1'
      })
    })

    test('Should treat an entry as fresh strictly before the 300 second boundary and expired at it', async () => {
      const { cache, userProfileClient, clock } = createHarness()
      const user = userFor('user-a')
      await cache.getUserRoles(user)

      clock.time += TTL_MS - 1
      expect((await cache.getUserRoles(user)).cacheState).toBe(
        UserRoleCacheState.HIT
      )
      expect(userProfileClient.getUserRoles).toHaveBeenCalledTimes(1)

      clock.time += 1
      expect((await cache.getUserRoles(user)).cacheState).toBe(
        UserRoleCacheState.REFRESHED
      )
      expect(userProfileClient.getUserRoles).toHaveBeenCalledTimes(2)
    })

    test('Should let a role change take effect no later than the TTL after the last successful retrieval', async () => {
      let roles = ['Owner']
      const { cache, clock } = createHarness({
        responder: async (user) => rolesFor(user.userId, roles)
      })
      const user = userFor('user-a')
      await cache.getUserRoles(user)
      roles = []

      clock.time += TTL_MS - 1
      expect((await cache.getUserRoles(user)).value.roleIds).toEqual(['Owner'])
      clock.time += 1
      expect((await cache.getUserRoles(user)).value.roleIds).toEqual([])
    })

    test('Should cache a valid no-role (unknown user) result for the normal TTL without inventing a role', async () => {
      const { cache, userProfileClient, clock } = createHarness({
        responder: async (user) => rolesFor(user.userId, [])
      })
      const user = userFor('unknown-user')

      const first = await cache.getUserRoles(user)
      await cache.getUserRoles(user)

      expect(first.value.roleIds).toEqual([])
      expect(userProfileClient.getUserRoles).toHaveBeenCalledTimes(1)
      clock.time += TTL_MS
      await cache.getUserRoles(user)
      expect(userProfileClient.getUserRoles).toHaveBeenCalledTimes(2)
    })
  })

  describe('failures are never cached or substituted', () => {
    test.each([
      [
        'a dependency failure',
        { ok: false, outcome: UserProfileOutcome.UNAVAILABLE, status: 503 },
        { source: 'dependency', outcome: UserProfileOutcome.UNAVAILABLE }
      ],
      [
        'a timeout',
        { ok: false, outcome: UserProfileOutcome.TIMEOUT, status: null },
        { source: 'dependency', outcome: UserProfileOutcome.TIMEOUT }
      ],
      [
        'a transport not-found',
        { ok: false, outcome: UserProfileOutcome.NOT_FOUND, status: 404 },
        { source: 'dependency', outcome: UserProfileOutcome.NOT_FOUND }
      ],
      [
        'a response for another user',
        rolesFor('someone-else', ['Admin']),
        {
          source: 'validation',
          reason: AuthorizationDataFailure.USER_ID_MISMATCH
        }
      ],
      [
        'malformed roles',
        rolesFor('user-a', 'none'),
        {
          source: 'validation',
          reason: AuthorizationDataFailure.WRONG_FIELD_TYPE
        }
      ]
    ])(
      'Should return %s and retry the dependency on the next lookup',
      async (_name, failing, expected) => {
        const queue = [failing, rolesFor('user-a', ['Owner'])]
        const { cache, userProfileClient } = createHarness({
          responder: async () => queue.shift()
        })
        const user = userFor('user-a')

        const failed = await cache.getUserRoles(user)
        const recovered = await cache.getUserRoles(user)

        expect(failed).toMatchObject({ ok: false, ...expected })
        expect(failed).not.toHaveProperty('value')
        expect(recovered).toMatchObject({
          ok: true,
          cacheState: UserRoleCacheState.REFRESHED
        })
        expect(userProfileClient.getUserRoles).toHaveBeenCalledTimes(2)
      }
    )

    test('Should never serve an expired entry when the refresh fails and should not extend its expiry', async () => {
      const queue = [
        rolesFor('user-a', ['Owner']),
        { ok: false, outcome: UserProfileOutcome.UNAVAILABLE, status: 503 },
        { ok: false, outcome: UserProfileOutcome.UNAVAILABLE, status: 503 },
        rolesFor('user-a', ['Skipper'])
      ]
      const { cache, userProfileClient, clock } = createHarness({
        responder: async () => queue.shift()
      })
      const user = userFor('user-a')
      await cache.getUserRoles(user)
      clock.time += TTL_MS

      const first = await cache.getUserRoles(user)
      clock.time += 1
      const second = await cache.getUserRoles(user)
      const recovered = await cache.getUserRoles(user)

      expect(first).toMatchObject({ ok: false, source: 'dependency' })
      expect(second).toMatchObject({ ok: false, source: 'dependency' })
      expect(userProfileClient.getUserRoles).toHaveBeenCalledTimes(4)
      expect(recovered.value.roleIds).toEqual(['Skipper'])
    })

    test('Should report an unexpected client exception as a cache failure and recover later', async () => {
      const queue = [new Error('boom'), rolesFor('user-a', ['Owner'])]
      const { cache, logger } = createHarness({
        responder: async () => {
          const next = queue.shift()
          if (next instanceof Error) {
            throw next
          }
          return next
        }
      })
      const user = userFor('user-a')

      await expect(cache.getUserRoles(user)).resolves.toEqual({
        ok: false,
        source: 'cache',
        reason: UserRoleCacheFailure.UNEXPECTED_CACHE_FAILURE
      })
      await expect(cache.getUserRoles(user)).resolves.toMatchObject({
        ok: true
      })
      expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('boom')
    })

    test.each([[null], [undefined], [{ userId: 'user-a' }], ['user-a']])(
      'Should refuse the untrusted user %j without any request',
      async (untrusted) => {
        const { cache, userProfileClient } = createHarness()

        await expect(cache.getUserRoles(untrusted)).resolves.toEqual({
          ok: false,
          source: 'cache',
          reason: UserRoleCacheFailure.UNTRUSTED_USER_CONTEXT
        })
        expect(userProfileClient.getUserRoles).not.toHaveBeenCalled()
      }
    )
  })

  describe('single-flight refresh', () => {
    test('Should share one refresh between concurrent lookups for the same user', async () => {
      const gate = deferred()
      const { cache, userProfileClient } = createHarness({
        responder: async (user) => {
          await gate.promise
          return rolesFor(user.userId, ['Owner'])
        }
      })
      const user = userFor('user-a')

      const pending = [
        cache.getUserRoles(user),
        cache.getUserRoles(user),
        cache.getUserRoles(user)
      ]
      gate.resolve()
      const results = await Promise.all(pending)

      expect(userProfileClient.getUserRoles).toHaveBeenCalledTimes(1)
      expect(results.every((result) => result.ok)).toBe(true)
      expect(new Set(results.map((result) => result.value)).size).toBe(1)
    })

    test('Should refresh different users independently without one slow user blocking another', async () => {
      const slow = deferred()
      const { cache } = createHarness({
        responder: async (user) => {
          if (user.userId === 'slow-user') {
            await slow.promise
          }
          return rolesFor(user.userId, ['Owner'])
        }
      })

      const slowPending = cache.getUserRoles(userFor('slow-user'))
      const fast = await cache.getUserRoles(userFor('fast-user'))

      expect(fast.ok).toBe(true)
      slow.resolve()
      await expect(slowPending).resolves.toMatchObject({ ok: true })
    })

    test('Should release the coordination state after a failure so the next lookup refreshes again', async () => {
      const queue = [
        { ok: false, outcome: UserProfileOutcome.TIMEOUT, status: null },
        rolesFor('user-a', ['Owner'])
      ]
      const { cache, userProfileClient } = createHarness({
        responder: async () => queue.shift()
      })
      const user = userFor('user-a')

      await cache.getUserRoles(user)
      await cache.getUserRoles(user)

      expect(userProfileClient.getUserRoles).toHaveBeenCalledTimes(2)
    })

    test('Should stop waiting for a cancelled caller without cancelling the shared refresh', async () => {
      const gate = deferred()
      const { cache, userProfileClient } = createHarness({
        responder: async (user) => {
          await gate.promise
          return rolesFor(user.userId, ['Owner'])
        }
      })
      const user = userFor('user-a')
      const controller = new AbortController()

      const cancelled = cache.getUserRoles(user, { signal: controller.signal })
      const other = cache.getUserRoles(user)
      controller.abort()

      await expect(cancelled).resolves.toEqual({
        ok: false,
        source: 'dependency',
        outcome: UserProfileOutcome.CANCELLED,
        status: null
      })
      gate.resolve()
      await expect(other).resolves.toMatchObject({ ok: true })
      await expect(cache.getUserRoles(user)).resolves.toMatchObject({
        cacheState: UserRoleCacheState.HIT
      })
      expect(userProfileClient.getUserRoles).toHaveBeenCalledTimes(1)
    })

    test('Should not start a refresh for an already-cancelled caller', async () => {
      const { cache, userProfileClient } = createHarness()

      await expect(
        cache.getUserRoles(userFor('user-a'), { signal: AbortSignal.abort() })
      ).resolves.toMatchObject({ outcome: UserProfileOutcome.CANCELLED })
      expect(userProfileClient.getUserRoles).not.toHaveBeenCalled()
    })

    test('Should not replace a newer entry with the result of an older refresh', async () => {
      const gate = deferred()
      const queue = [rolesFor('user-a', ['New']), 'slow']
      const { cache, clock } = createHarness({
        responder: async (user) => {
          const next = queue.shift()
          if (next === 'slow') {
            await gate.promise
            return rolesFor(user.userId, ['Old'])
          }
          return next
        }
      })
      const user = userFor('user-a')
      await cache.getUserRoles(user)
      clock.time += TTL_MS
      const slowRefresh = cache.getUserRoles(user)
      clock.time -= TTL_MS + 500
      gate.resolve()

      await expect(slowRefresh).resolves.toMatchObject({ ok: true })
      clock.time += 1
      expect((await cache.getUserRoles(user)).value.roleIds).toEqual(['New'])
    })
  })

  describe('capacity and eviction', () => {
    test('Should never exceed the maximum entries and evict the least recently used user', async () => {
      const { cache, userProfileClient } = createHarness({ maximumEntries: 2 })
      const [a, b, c] = ['user-a', 'user-b', 'user-c'].map(userFor)
      await cache.getUserRoles(a)
      await cache.getUserRoles(b)
      await cache.getUserRoles(c)
      expect(userProfileClient.getUserRoles).toHaveBeenCalledTimes(3)

      await cache.getUserRoles(b)
      await cache.getUserRoles(c)
      expect(userProfileClient.getUserRoles).toHaveBeenCalledTimes(3)

      await cache.getUserRoles(a)
      expect(userProfileClient.getUserRoles).toHaveBeenCalledTimes(4)
    })

    test('Should count a hit as use when choosing the eviction candidate', async () => {
      const { cache, userProfileClient } = createHarness({ maximumEntries: 2 })
      const [a, b, c] = ['user-a', 'user-b', 'user-c'].map(userFor)
      await cache.getUserRoles(a)
      await cache.getUserRoles(b)
      await cache.getUserRoles(a)
      await cache.getUserRoles(c)

      await cache.getUserRoles(a)
      expect(userProfileClient.getUserRoles).toHaveBeenCalledTimes(3)
      await cache.getUserRoles(b)
      expect(userProfileClient.getUserRoles).toHaveBeenCalledTimes(4)
    })

    test('Should remove expired entries before evicting a fresh one', async () => {
      const { cache, userProfileClient, clock } = createHarness({
        maximumEntries: 2
      })
      const [a, b, c] = ['user-a', 'user-b', 'user-c'].map(userFor)
      await cache.getUserRoles(a)
      clock.time += TTL_MS - 10
      await cache.getUserRoles(b)
      clock.time += 10
      await cache.getUserRoles(c)

      await cache.getUserRoles(b)
      await cache.getUserRoles(c)
      expect(userProfileClient.getUserRoles).toHaveBeenCalledTimes(3)
    })

    test('Should isolate different users from one another', async () => {
      const { cache } = createHarness({
        responder: async (user) =>
          rolesFor(user.userId, [`Role-${user.userId}`])
      })

      const a = await cache.getUserRoles(userFor('user-a'))
      const b = await cache.getUserRoles(userFor('user-b'))

      expect(a.value.roleIds).toEqual(['Role-user-a'])
      expect(b.value.roleIds).toEqual(['Role-user-b'])
    })

    test('Should tolerate a clear while a refresh is still in flight', async () => {
      const gate = deferred()
      const { cache, userProfileClient } = createHarness({
        responder: async (user) => {
          await gate.promise
          return rolesFor(user.userId, ['Owner'])
        }
      })
      const user = userFor('user-a')

      const pending = cache.getUserRoles(user)
      cache.clear()
      gate.resolve()

      await expect(pending).resolves.toMatchObject({ ok: true })
      await expect(cache.getUserRoles(user)).resolves.toMatchObject({
        ok: true
      })
      expect(userProfileClient.getUserRoles).toHaveBeenCalledTimes(1)
    })

    test('Should drop all cached data on clear', async () => {
      const { cache, userProfileClient } = createHarness()
      const user = userFor('user-a')
      await cache.getUserRoles(user)

      cache.clear()
      await cache.getUserRoles(user)

      expect(userProfileClient.getUserRoles).toHaveBeenCalledTimes(2)
    })
  })

  describe('privacy', () => {
    test('Should log only safe events without identifiers, roles or tokens', async () => {
      const { cache, logger } = createHarness({
        maximumEntries: 1,
        responder: async (user) => rolesFor(user.userId, ['Secret-Role'])
      })

      await cache.getUserRoles(userFor('secret-user-1'))
      await cache.getUserRoles(userFor('secret-user-2'))
      const logged = JSON.stringify([
        ...logger.debug.mock.calls,
        ...logger.warn.mock.calls
      ])

      expect(logged).toContain('user-role-cache.entry-evicted')
      expect(logged).not.toMatch(/secret-user|Secret-Role/)
    })

    test('Should work without a logger and with the default monotonic clock', async () => {
      const cache = createUserRoleCache({
        userProfileClient: {
          getUserRoles: async (user) => rolesFor(user.userId, ['Owner'])
        },
        ttlSeconds: TTL_SECONDS,
        maximumEntries: 5
      })
      const user = userFor('user-a')

      await expect(cache.getUserRoles(user)).resolves.toMatchObject({
        ok: true
      })
      await expect(cache.getUserRoles(user)).resolves.toMatchObject({
        cacheState: UserRoleCacheState.HIT
      })
    })
  })
})
