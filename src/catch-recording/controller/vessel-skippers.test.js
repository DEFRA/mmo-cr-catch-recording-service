import { isApplicationError } from '#/common/helpers/errors/application-error.js'
import { listSkippers, addSkipper, removeSkipper } from './vessel-skippers.js'
import { IDEMPOTENCY_OPERATION_SCOPES } from '../persistence/idempotency-operation-scope.js'
import { computeRequestFingerprint } from '../persistence/idempotency-fingerprint.js'

const OWNER_USER_ID = 'owner-1'
const VESSEL_ID = 'vessel-1'
const OTHER_VESSEL_ID = 'vessel-2'

function matchesEqualityFilter(document, filter) {
  return Object.entries(filter).every(([key, value]) => {
    if (key === '_id') {
      return document._id === value
    }
    if (value && typeof value === 'object' && '$ne' in value) {
      return !(document.skippers ?? []).some(
        (skipper) => skipper.normalisedName === value.$ne
      )
    }
    return document[key] === value
  })
}

/** Mirrors `vessel-favourites.test.js`'s purpose-built fake collection - the one shape
 * `vessel-profile-persistence.js` relies on, including the exact `skippers.normalisedName: { $ne }`
 * duplicate-key race `addSkipper` disambiguates. */
function buildFakeVesselProfileCollection() {
  const store = new Map()

  function applyArrayOperators(document, update) {
    if (update.$push) {
      for (const [field, value] of Object.entries(update.$push)) {
        document[field] = document[field] ?? []
        document[field].push(value)
      }
    }
    if (update.$pull) {
      for (const [field, condition] of Object.entries(update.$pull)) {
        document[field] = document[field] ?? []
        document[field] = document[field].filter(
          (item) =>
            !Object.entries(condition).every(
              ([key, value]) => item[key] === value
            )
        )
      }
    }
    if (update.$set) {
      Object.assign(document, update.$set)
    }
  }

  return {
    findOne: vi.fn(async (filter) => {
      const existing = store.get(filter._id)
      return existing ? structuredClone(existing) : null
    }),
    findOneAndUpdate: vi.fn(async (filter, update, options = {}) => {
      const existing = store.get(filter._id)

      if (existing && !matchesEqualityFilter(existing, filter)) {
        if (options.upsert) {
          const error = new Error('E11000 duplicate key error')
          error.code = 11000
          throw error
        }
        return null
      }

      if (!existing && !options.upsert) {
        return null
      }

      const document = existing ?? {
        _id: filter._id,
        ...(update.$setOnInsert ?? {})
      }

      applyArrayOperators(document, update)
      store.set(document._id, document)
      return structuredClone(document)
    }),
    _store: store
  }
}

function buildIdempotencyCollection() {
  const store = new Map()
  return {
    insertOne: vi.fn(async (document) => {
      const key = `${document.ownerUserId}|${document.operationScope}|${document.idempotencyKey}|${document.resourceId}`
      if (store.has(key)) {
        const error = new Error('E11000 duplicate key error')
        error.code = 11000
        throw error
      }
      store.set(key, { ...document })
      return { acknowledged: true }
    }),
    findOne: vi.fn(async (filter) => {
      const key = `${filter.ownerUserId}|${filter.operationScope}|${filter.idempotencyKey}|${filter.resourceId}`
      const found = store.get(key)
      return found ? { ...found } : null
    }),
    findOneAndUpdate: vi.fn(async (filter, update) => {
      const key = `${filter.ownerUserId}|${filter.operationScope}|${filter.idempotencyKey}|${filter.resourceId}`
      const existing = store.get(key)
      if (!existing || existing.fingerprint !== filter.fingerprint) {
        return null
      }
      const updated = { ...existing, ...update.$set }
      store.set(key, updated)
      return { ...updated }
    })
  }
}

function buildFakeDb() {
  const collections = {
    'vessel-profiles': buildFakeVesselProfileCollection(),
    'catch-idempotency-claims': buildIdempotencyCollection()
  }

  return { collection: vi.fn((name) => collections[name]), collections }
}

function fakeReferenceDataClient({ accessibleVesselIds = [VESSEL_ID] } = {}) {
  return { listAccessibleVesselIds: vi.fn(async () => accessibleVesselIds) }
}

function authenticationContext(userId = OWNER_USER_ID) {
  return Object.freeze({ userId, scopes: Object.freeze([]) })
}

describe('#vessel-skippers', () => {
  describe('listSkippers', () => {
    test('returns an empty list when no profile exists', async () => {
      const db = buildFakeDb()

      const response = await listSkippers({
        db,
        referenceDataClient: fakeReferenceDataClient(),
        authenticationContext: authenticationContext(),
        vesselId: VESSEL_ID
      })

      expect(response).toEqual({ vesselId: VESSEL_ID, skippers: [] })
    })

    test('denies a vessel the caller cannot access', async () => {
      const db = buildFakeDb()

      await expect(
        listSkippers({
          db,
          referenceDataClient: fakeReferenceDataClient({
            accessibleVesselIds: [OTHER_VESSEL_ID]
          }),
          authenticationContext: authenticationContext(),
          vesselId: VESSEL_ID
        })
      ).rejects.toSatisfy(isApplicationError)
    })
  })

  describe('addSkipper', () => {
    test('adds a skipper with a server-generated id and only the approved public fields', async () => {
      const db = buildFakeDb()

      const response = await addSkipper({
        db,
        referenceDataClient: fakeReferenceDataClient(),
        authenticationContext: authenticationContext(),
        vesselId: VESSEL_ID,
        name: 'Jane Doe',
        phoneNumber: '01234',
        email: 'jane@example.com'
      })

      expect(response.skippers).toHaveLength(1)
      expect(response.skippers[0]).toMatchObject({
        name: 'Jane Doe',
        phoneNumber: '01234',
        email: 'jane@example.com'
      })
      expect(typeof response.skippers[0].id).toBe('string')
      expect(response.skippers[0].id.length).toBeGreaterThan(0)
    })

    test('is idempotent for a case-insensitive, trimmed duplicate name on the same vessel', async () => {
      const db = buildFakeDb()
      const referenceDataClient = fakeReferenceDataClient()

      const first = await addSkipper({
        db,
        referenceDataClient,
        authenticationContext: authenticationContext(),
        vesselId: VESSEL_ID,
        name: 'Jane Doe'
      })

      const second = await addSkipper({
        db,
        referenceDataClient,
        authenticationContext: authenticationContext(),
        vesselId: VESSEL_ID,
        name: '  JANE DOE  '
      })

      expect(second.skippers).toHaveLength(1)
      expect(second.skippers[0].id).toBe(first.skippers[0].id)
    })

    test('allows the same name on a different vessel', async () => {
      const db = buildFakeDb()
      const referenceDataClient = fakeReferenceDataClient({
        accessibleVesselIds: [VESSEL_ID, OTHER_VESSEL_ID]
      })

      await addSkipper({
        db,
        referenceDataClient,
        authenticationContext: authenticationContext(),
        vesselId: VESSEL_ID,
        name: 'Jane Doe'
      })
      const response = await addSkipper({
        db,
        referenceDataClient,
        authenticationContext: authenticationContext(),
        vesselId: OTHER_VESSEL_ID,
        name: 'Jane Doe'
      })

      expect(response.skippers).toHaveLength(1)
    })

    test('rejects a missing name', async () => {
      const db = buildFakeDb()

      await expect(
        addSkipper({
          db,
          referenceDataClient: fakeReferenceDataClient(),
          authenticationContext: authenticationContext(),
          vesselId: VESSEL_ID,
          name: ''
        })
      ).rejects.toSatisfy(isApplicationError)
    })

    test('denies a vessel the caller cannot access, without mutating the profile', async () => {
      const db = buildFakeDb()

      await expect(
        addSkipper({
          db,
          referenceDataClient: fakeReferenceDataClient({
            accessibleVesselIds: [OTHER_VESSEL_ID]
          }),
          authenticationContext: authenticationContext(),
          vesselId: VESSEL_ID,
          name: 'Jane Doe'
        })
      ).rejects.toSatisfy(isApplicationError)

      expect(db.collections['vessel-profiles']._store.size).toBe(0)
    })

    test('respects an Idempotency-Key without erroring on replay', async () => {
      const db = buildFakeDb()
      const referenceDataClient = fakeReferenceDataClient()
      const input = {
        db,
        referenceDataClient,
        authenticationContext: authenticationContext(),
        vesselId: VESSEL_ID,
        name: 'Jane Doe',
        idempotencyKey: 'client-key-1'
      }

      const first = await addSkipper(input)
      const second = await addSkipper(input)

      expect(second.skippers).toHaveLength(1)
      expect(second.skippers[0].id).toBe(first.skippers[0].id)
    })

    test('rejects a request already in progress for the same Idempotency-Key', async () => {
      const db = buildFakeDb()
      const fingerprint = computeRequestFingerprint({
        operationScope: IDEMPOTENCY_OPERATION_SCOPES.ADD_SKIPPER,
        idempotencyKey: 'client-key-1',
        allowedFields: ['vesselId', 'name', 'phoneNumber', 'email'],
        semanticInput: {
          vesselId: VESSEL_ID,
          name: 'Jane Doe',
          phoneNumber: null,
          email: null
        }
      })
      await db.collections['catch-idempotency-claims'].insertOne({
        ownerUserId: OWNER_USER_ID,
        operationScope: IDEMPOTENCY_OPERATION_SCOPES.ADD_SKIPPER,
        idempotencyKey: 'client-key-1',
        resourceId: VESSEL_ID,
        fingerprint,
        state: 'PENDING',
        createdAt: new Date().toISOString()
      })

      await expect(
        addSkipper({
          db,
          referenceDataClient: fakeReferenceDataClient(),
          authenticationContext: authenticationContext(),
          vesselId: VESSEL_ID,
          name: 'Jane Doe',
          idempotencyKey: 'client-key-1'
        })
      ).rejects.toSatisfy(isApplicationError)
    })
  })

  describe('removeSkipper', () => {
    test('removes an existing skipper and is safe to repeat', async () => {
      const db = buildFakeDb()
      const referenceDataClient = fakeReferenceDataClient()

      const added = await addSkipper({
        db,
        referenceDataClient,
        authenticationContext: authenticationContext(),
        vesselId: VESSEL_ID,
        name: 'Jane Doe'
      })
      const skipperId = added.skippers[0].id

      await removeSkipper({
        db,
        referenceDataClient,
        authenticationContext: authenticationContext(),
        vesselId: VESSEL_ID,
        skipperId
      })
      const secondRemove = await removeSkipper({
        db,
        referenceDataClient,
        authenticationContext: authenticationContext(),
        vesselId: VESSEL_ID,
        skipperId
      })

      expect(secondRemove).toBeUndefined()
      const listResponse = await listSkippers({
        db,
        referenceDataClient,
        authenticationContext: authenticationContext(),
        vesselId: VESSEL_ID
      })
      expect(listResponse.skippers).toEqual([])
    })

    test('is safe when no profile exists yet', async () => {
      const db = buildFakeDb()

      await expect(
        removeSkipper({
          db,
          referenceDataClient: fakeReferenceDataClient(),
          authenticationContext: authenticationContext(),
          vesselId: VESSEL_ID,
          skipperId: 'unknown-skipper'
        })
      ).resolves.toBeUndefined()
    })

    test('rejects a missing skipperId', async () => {
      const db = buildFakeDb()

      await expect(
        removeSkipper({
          db,
          referenceDataClient: fakeReferenceDataClient(),
          authenticationContext: authenticationContext(),
          vesselId: VESSEL_ID,
          skipperId: ''
        })
      ).rejects.toSatisfy(isApplicationError)
    })

    test('denies a vessel the caller cannot access', async () => {
      const db = buildFakeDb()

      await expect(
        removeSkipper({
          db,
          referenceDataClient: fakeReferenceDataClient({
            accessibleVesselIds: [OTHER_VESSEL_ID]
          }),
          authenticationContext: authenticationContext(),
          vesselId: VESSEL_ID,
          skipperId: 'skipper-1'
        })
      ).rejects.toSatisfy(isApplicationError)
    })
  })
})
