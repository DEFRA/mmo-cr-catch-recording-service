import { vi } from 'vitest'

import { AuthorizationDataFailure } from './authorization-response-validator.js'
import {
  createRoleDefinitionsCache,
  RoleDefinitionsCacheFailure,
  RoleDefinitionsCacheState,
  SnapshotState
} from './role-definitions-cache.js'
import { UserProfileOutcome } from './user-profile-client.js'

const SERVICE_ID = 'catch-recording'
const TTL_MS = 60_000
const STALE_MS = 300_000

const definitionsFor = (version, overrides = {}) => ({
  ok: true,
  body: {
    schemaVersion: '1.0',
    definitionsVersion: version,
    serviceId: SERVICE_ID,
    updatedAt: '2026-11-05T00:00:00Z',
    roles: [{ roleId: 'Owner', capabilityIds: ['catch-record.read'] }],
    ...overrides
  }
})
const unavailable = {
  ok: false,
  outcome: UserProfileOutcome.UNAVAILABLE,
  status: 503
}
const deferred = () => {
  let release
  const promise = new Promise((resolve) => {
    release = resolve
  })
  return { promise, resolve: release }
}

function createHarness({ responses = [definitionsFor('1')], responder } = {}) {
  const clock = { time: 1000 }
  const queue = [...responses]
  const userProfileClient = {
    getRoleDefinitions: vi.fn(
      responder ??
        (async () => {
          const next = queue.length > 1 ? queue.shift() : queue[0]
          if (next instanceof Error) {
            throw next
          }
          return next
        })
    )
  }
  const logger = { debug: vi.fn(), warn: vi.fn() }
  const cache = createRoleDefinitionsCache({
    userProfileClient,
    serviceId: SERVICE_ID,
    ttlSeconds: TTL_MS / 1000,
    maximumStaleSeconds: STALE_MS / 1000,
    now: () => clock.time,
    logger
  })

  return { cache, userProfileClient, logger, clock }
}

describe('#createRoleDefinitionsCache', () => {
  describe('lazy load and fresh lookups', () => {
    test('Should load when absent, publish an immutable snapshot with local timing and then serve hits', async () => {
      const { cache, userProfileClient } = createHarness()

      const first = await cache.getRoleDefinitions({ correlationId: 'corr-1' })
      const second = await cache.getRoleDefinitions()

      expect(first).toMatchObject({
        ok: true,
        freshness: SnapshotState.FRESH,
        cacheState: RoleDefinitionsCacheState.LOADED
      })
      expect(first.snapshot).toMatchObject({
        serviceId: SERVICE_ID,
        definitionsVersion: '1',
        loadedAt: 1000,
        freshUntil: 1000 + TTL_MS,
        maximumStaleUntil: 1000 + TTL_MS + STALE_MS
      })
      expect(first.snapshot.roles).toEqual([
        { roleId: 'Owner', capabilityIds: ['catch-record.read'] }
      ])
      expect(Object.isFrozen(first.snapshot)).toBe(true)
      expect(second.cacheState).toBe(RoleDefinitionsCacheState.HIT)
      expect(second.snapshot).toBe(first.snapshot)
      expect(userProfileClient.getRoleDefinitions).toHaveBeenCalledTimes(1)
      expect(userProfileClient.getRoleDefinitions).toHaveBeenCalledWith({
        correlationId: 'corr-1'
      })
    })

    test('Should use exactly the freshness boundary and never extend a lifetime by reading', async () => {
      const { cache, userProfileClient, clock } = createHarness()
      await cache.getRoleDefinitions()

      clock.time += TTL_MS - 1
      expect((await cache.getRoleDefinitions()).cacheState).toBe(
        RoleDefinitionsCacheState.HIT
      )
      expect((await cache.getRoleDefinitions()).snapshot.freshUntil).toBe(
        1000 + TTL_MS
      )
      expect(userProfileClient.getRoleDefinitions).toHaveBeenCalledTimes(1)

      clock.time += 1
      await cache.getRoleDefinitions()
      expect(userProfileClient.getRoleDefinitions).toHaveBeenCalledTimes(2)
    })
  })

  describe('stale and over-stale snapshots', () => {
    test('Should replace a stale snapshot with the refreshed one and recalculate timing from the new load', async () => {
      const { cache, clock } = createHarness({
        responses: [definitionsFor('1'), definitionsFor('2')]
      })
      await cache.getRoleDefinitions()
      clock.time += TTL_MS

      const result = await cache.getRoleDefinitions()

      expect(result).toMatchObject({
        ok: true,
        freshness: SnapshotState.FRESH,
        cacheState: RoleDefinitionsCacheState.REFRESHED
      })
      expect(result.snapshot).toMatchObject({
        definitionsVersion: '2',
        loadedAt: 1000 + TTL_MS,
        freshUntil: 1000 + 2 * TTL_MS
      })
    })

    test('Should return the previous snapshot as stale-used when a stale refresh fails, changing no timing', async () => {
      const { cache, clock, logger } = createHarness({
        responses: [definitionsFor('1'), unavailable]
      })
      const loaded = await cache.getRoleDefinitions()
      clock.time += TTL_MS

      const result = await cache.getRoleDefinitions()

      expect(result).toMatchObject({
        ok: true,
        freshness: SnapshotState.STALE,
        cacheState: RoleDefinitionsCacheState.STALE_USED,
        refreshFailure: {
          source: 'dependency',
          outcome: UserProfileOutcome.UNAVAILABLE
        }
      })
      expect(result.snapshot).toBe(loaded.snapshot)
      expect(result.snapshot.freshUntil).toBe(1000 + TTL_MS)
      expect(result.snapshot.maximumStaleUntil).toBe(1000 + TTL_MS + STALE_MS)
      expect(logger.warn).toHaveBeenCalled()
    })

    test('Should stop using the snapshot at the exact maximum-stale boundary and never extend it after a failed refresh', async () => {
      const { cache, clock } = createHarness({
        responses: [definitionsFor('1'), unavailable]
      })
      await cache.getRoleDefinitions()

      clock.time += TTL_MS + STALE_MS - 1
      expect((await cache.getRoleDefinitions()).cacheState).toBe(
        RoleDefinitionsCacheState.STALE_USED
      )

      clock.time += 1
      const overStale = await cache.getRoleDefinitions()
      expect(overStale).toMatchObject({
        ok: false,
        source: 'dependency',
        snapshotState: SnapshotState.OVER_STALE
      })
      expect(overStale).not.toHaveProperty('snapshot')
    })

    test('Should recover from over-stale once a refresh succeeds', async () => {
      const { cache, clock } = createHarness({
        responses: [definitionsFor('1'), unavailable, definitionsFor('3')]
      })
      await cache.getRoleDefinitions()
      clock.time += TTL_MS + STALE_MS
      await cache.getRoleDefinitions()

      const recovered = await cache.getRoleDefinitions()

      expect(recovered).toMatchObject({
        ok: true,
        cacheState: RoleDefinitionsCacheState.REFRESHED
      })
      expect(recovered.snapshot.definitionsVersion).toBe('3')
    })

    test('Should re-evaluate the snapshot after a slow refresh and not return one that went over-stale meanwhile', async () => {
      const gate = deferred()
      const queue = [definitionsFor('1'), 'slow-failure']
      const { cache, clock } = createHarness({
        responder: async () => {
          const next = queue.shift()
          if (next === 'slow-failure') {
            await gate.promise
            return unavailable
          }
          return next
        }
      })
      await cache.getRoleDefinitions()
      clock.time += TTL_MS + STALE_MS - 1

      const pending = cache.getRoleDefinitions()
      clock.time += 1
      gate.resolve()

      await expect(pending).resolves.toMatchObject({
        ok: false,
        snapshotState: SnapshotState.OVER_STALE
      })
    })
  })

  describe('failures and unusable data', () => {
    test('Should fail without a snapshot when the first load fails and retry on the next lookup', async () => {
      const { cache, userProfileClient } = createHarness({
        responses: [unavailable, definitionsFor('1')]
      })

      const failed = await cache.getRoleDefinitions()
      const recovered = await cache.getRoleDefinitions()

      expect(failed).toMatchObject({
        ok: false,
        source: 'dependency',
        outcome: UserProfileOutcome.UNAVAILABLE,
        snapshotState: SnapshotState.ABSENT
      })
      expect(failed).not.toHaveProperty('snapshot')
      expect(recovered.cacheState).toBe(RoleDefinitionsCacheState.LOADED)
      expect(userProfileClient.getRoleDefinitions).toHaveBeenCalledTimes(2)
    })

    test.each([
      [
        'empty definitions',
        definitionsFor('2', { roles: [] }),
        AuthorizationDataFailure.EMPTY_ROLE_DEFINITIONS
      ],
      [
        'another service',
        definitionsFor('2', { serviceId: 'other' }),
        AuthorizationDataFailure.SERVICE_ID_MISMATCH
      ],
      [
        'an unsupported schema',
        definitionsFor('2', { schemaVersion: '9.9' }),
        AuthorizationDataFailure.UNSUPPORTED_SCHEMA_VERSION
      ],
      [
        'malformed definitions',
        definitionsFor('2', { roles: [{ roleId: 'A' }] }),
        AuthorizationDataFailure.MISSING_REQUIRED_FIELD
      ]
    ])(
      'Should not replace or clear a valid snapshot with %s',
      async (_name, invalid, reason) => {
        const { cache, clock } = createHarness({
          responses: [definitionsFor('1'), invalid]
        })
        const loaded = await cache.getRoleDefinitions()
        clock.time += TTL_MS

        const result = await cache.getRoleDefinitions()

        expect(result).toMatchObject({
          ok: true,
          cacheState: RoleDefinitionsCacheState.STALE_USED,
          refreshFailure: { source: 'validation', reason }
        })
        expect(result.snapshot).toBe(loaded.snapshot)
        expect(cache.getStatus().definitionsVersion).toBe('1')
      }
    )

    test('Should never publish invalid or empty data as the first snapshot', async () => {
      const { cache } = createHarness({
        responses: [definitionsFor('1', { roles: [] })]
      })

      const result = await cache.getRoleDefinitions()

      expect(result).toMatchObject({
        ok: false,
        source: 'validation',
        reason: AuthorizationDataFailure.EMPTY_ROLE_DEFINITIONS,
        snapshotState: SnapshotState.ABSENT
      })
      expect(cache.getStatus()).toEqual({
        state: SnapshotState.ABSENT,
        definitionsVersion: null
      })
    })

    test('Should report an unexpected client exception as a cache failure and use a stale snapshot only within its window', async () => {
      const { cache, clock } = createHarness({
        responses: [definitionsFor('1'), new Error('boom')]
      })
      await cache.getRoleDefinitions()
      clock.time += TTL_MS

      const stale = await cache.getRoleDefinitions()
      clock.time += STALE_MS
      const overStale = await cache.getRoleDefinitions()

      expect(stale.refreshFailure).toEqual({
        source: 'cache',
        reason: RoleDefinitionsCacheFailure.UNEXPECTED_CACHE_FAILURE
      })
      expect(overStale).toMatchObject({
        ok: false,
        source: 'cache',
        snapshotState: SnapshotState.OVER_STALE
      })
    })
  })

  describe('single-flight, ordering and cancellation', () => {
    test.each([
      ['absent', 0],
      ['stale', TTL_MS],
      ['over-stale', TTL_MS + STALE_MS]
    ])(
      'Should share one refresh between concurrent %s lookups',
      async (_name, advance) => {
        const gate = deferred()
        let calls = 0
        const { cache, userProfileClient, clock } = createHarness({
          responder: async () => {
            calls += 1
            if (calls > 1 || advance === 0) {
              await gate.promise
            }
            return definitionsFor(`v${calls}`)
          }
        })
        if (advance > 0) {
          await cache.getRoleDefinitions()
          clock.time += advance
        }

        const pending = [
          cache.getRoleDefinitions(),
          cache.getRoleDefinitions(),
          cache.getRoleDefinitions()
        ]
        gate.resolve()
        const results = await Promise.all(pending)

        expect(results.every((result) => result.ok)).toBe(true)
        expect(new Set(results.map((result) => result.snapshot)).size).toBe(1)
        expect(userProfileClient.getRoleDefinitions).toHaveBeenCalledTimes(
          advance === 0 ? 1 : 2
        )
      }
    )

    test('Should stop waiting for a cancelled caller without cancelling the shared refresh', async () => {
      const gate = deferred()
      const { cache, userProfileClient } = createHarness({
        responder: async () => {
          await gate.promise
          return definitionsFor('1')
        }
      })
      const controller = new AbortController()

      const cancelled = cache.getRoleDefinitions({ signal: controller.signal })
      const other = cache.getRoleDefinitions()
      controller.abort()

      await expect(cancelled).resolves.toEqual({
        ok: false,
        source: 'dependency',
        outcome: UserProfileOutcome.CANCELLED,
        status: null
      })
      gate.resolve()
      await expect(other).resolves.toMatchObject({ ok: true })
      expect(userProfileClient.getRoleDefinitions).toHaveBeenCalledTimes(1)
    })

    test('Should not start a refresh for an already-cancelled caller', async () => {
      const { cache, userProfileClient } = createHarness()

      await expect(
        cache.getRoleDefinitions({ signal: AbortSignal.abort() })
      ).resolves.toMatchObject({ outcome: UserProfileOutcome.CANCELLED })
      expect(userProfileClient.getRoleDefinitions).not.toHaveBeenCalled()
    })

    test('Should not let an older result overwrite a newer valid snapshot', async () => {
      const gate = deferred()
      const queue = [definitionsFor('new'), 'slow-old']
      const { cache, clock } = createHarness({
        responder: async () => {
          const next = queue.shift()
          if (next === 'slow-old') {
            await gate.promise
            return definitionsFor('old')
          }
          return next
        }
      })
      await cache.getRoleDefinitions()
      clock.time += TTL_MS
      const slow = cache.getRoleDefinitions()
      clock.time -= TTL_MS + 500
      gate.resolve()

      const result = await slow
      expect(result.snapshot.definitionsVersion).toBe('new')
      expect(cache.getStatus().definitionsVersion).toBe('new')
    })
  })

  describe('status, lifecycle and privacy', () => {
    test('Should report the snapshot state for later health reporting without exposing definitions', async () => {
      const { cache, clock } = createHarness()
      expect(cache.getStatus().state).toBe(SnapshotState.ABSENT)

      await cache.getRoleDefinitions()
      expect(cache.getStatus()).toEqual({
        state: SnapshotState.FRESH,
        definitionsVersion: '1'
      })
      clock.time += TTL_MS
      expect(cache.getStatus().state).toBe(SnapshotState.STALE)
      clock.time += STALE_MS
      expect(cache.getStatus().state).toBe(SnapshotState.OVER_STALE)
    })

    test('Should tolerate a clear while a refresh is still in flight', async () => {
      const gate = deferred()
      const { cache } = createHarness({
        responder: async () => {
          await gate.promise
          return definitionsFor('1')
        }
      })

      const pending = cache.getRoleDefinitions()
      cache.clear()
      gate.resolve()

      await expect(pending).resolves.toMatchObject({ ok: true })
    })

    test('Should drop the snapshot on clear', async () => {
      const { cache, userProfileClient } = createHarness()
      await cache.getRoleDefinitions()

      cache.clear()
      await cache.getRoleDefinitions()

      expect(userProfileClient.getRoleDefinitions).toHaveBeenCalledTimes(2)
    })

    test('Should log only safe facts without roles, capabilities or response bodies', async () => {
      const { cache, logger, clock } = createHarness({
        responses: [
          definitionsFor('1', {
            roles: [
              { roleId: 'Secret-Role', capabilityIds: ['secret.capability'] }
            ]
          }),
          unavailable
        ]
      })
      await cache.getRoleDefinitions()
      clock.time += TTL_MS
      await cache.getRoleDefinitions()

      const logged = JSON.stringify([
        ...logger.debug.mock.calls,
        ...logger.warn.mock.calls
      ])
      expect(logged).toContain('role-definitions-cache.refresh-failed')
      expect(logged).not.toMatch(/Secret-Role|secret\.capability/)
    })

    test('Should work without a logger and with the default monotonic clock', async () => {
      const cache = createRoleDefinitionsCache({
        userProfileClient: {
          getRoleDefinitions: async () => definitionsFor('1')
        },
        serviceId: SERVICE_ID,
        ttlSeconds: 60,
        maximumStaleSeconds: 300
      })

      await expect(cache.getRoleDefinitions()).resolves.toMatchObject({
        ok: true
      })
      await expect(cache.getRoleDefinitions()).resolves.toMatchObject({
        cacheState: RoleDefinitionsCacheState.HIT
      })
    })
  })
})
