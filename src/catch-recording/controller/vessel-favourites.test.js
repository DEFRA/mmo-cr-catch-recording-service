import { isApplicationError } from '#/common/helpers/errors/application-error.js'
import {
  listFavouriteGears,
  addFavouriteGear,
  removeFavouriteGear,
  listFavouriteSpecies,
  addFavouriteSpecies,
  removeFavouriteSpecies,
  listFavouritePorts,
  addFavouritePort,
  removeFavouritePort
} from './vessel-favourites.js'
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
      return document[key] !== value.$ne
    }
    return document[key] === value
  })
}

/** A small, purpose-built in-memory fake of the one Mongo collection shape
 * `vessel-profile-persistence.js` relies on - `$addToSet`/`$pull`/`$push`/`$setOnInsert`/`$set`, plus the
 * exact duplicate-key race this module's `addSkipper` disambiguates. Not a general Mongo emulator - only
 * what this module's atomic update shapes require. */
function buildFakeVesselProfileCollection() {
  const store = new Map()

  function applyArrayOperators(document, update) {
    if (update.$addToSet) {
      for (const [field, value] of Object.entries(update.$addToSet)) {
        document[field] = document[field] ?? []
        if (!document[field].includes(value)) {
          document[field].push(value)
        }
      }
    }
    if (update.$push) {
      for (const [field, value] of Object.entries(update.$push)) {
        document[field] = document[field] ?? []
        document[field].push(value)
      }
    }
    if (update.$pull) {
      for (const [field, condition] of Object.entries(update.$pull)) {
        document[field] = document[field] ?? []
        if (condition && typeof condition === 'object') {
          document[field] = document[field].filter(
            (item) =>
              !Object.entries(condition).every(
                ([key, value]) => item[key] === value
              )
          )
        } else {
          document[field] = document[field].filter((item) => item !== condition)
        }
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

function buildFakeDb() {
  const collections = {
    'vessel-profiles': buildFakeVesselProfileCollection(),
    'catch-idempotency-claims': buildIdempotencyCollection()
  }

  return { collection: vi.fn((name) => collections[name]), collections }
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

function fakeReferenceDataClient({ accessibleVesselIds = [VESSEL_ID] } = {}) {
  return {
    listAccessibleVesselIds: vi.fn(async () => accessibleVesselIds),
    getGearById: vi.fn(async (id) => ({
      id,
      code: 'GN',
      name: 'Gillnet',
      active: true
    })),
    getSpeciesById: vi.fn(async (id) => ({
      id,
      faoCode: 'COD',
      scientificName: 'Gadus morhua',
      commonNames: [{ name: 'Cod' }],
      active: true
    })),
    getPortById: vi.fn(async (id) => ({
      id,
      code: 'GRK',
      name: 'Grimsby',
      active: true
    }))
  }
}

function authenticationContext(userId = OWNER_USER_ID) {
  return Object.freeze({ userId, scopes: Object.freeze([]) })
}

describe.each([
  {
    label: 'gear',
    list: listFavouriteGears,
    add: addFavouriteGear,
    remove: removeFavouriteGear,
    idField: 'gearId',
    field: 'favouriteGearIds',
    exampleId: 'gear-1'
  },
  {
    label: 'species',
    list: listFavouriteSpecies,
    add: addFavouriteSpecies,
    remove: removeFavouriteSpecies,
    idField: 'speciesId',
    field: 'favouriteSpeciesIds',
    exampleId: 'species-1'
  },
  {
    label: 'port',
    list: listFavouritePorts,
    add: addFavouritePort,
    remove: removeFavouritePort,
    idField: 'portId',
    field: 'favouritePortIds',
    exampleId: 'port-1'
  }
])(
  '#vessel-favourites ($label)',
  ({ list, add, remove, idField, field, exampleId }) => {
    test('list returns the default empty favourite array when no profile exists', async () => {
      const db = buildFakeDb()

      const response = await list({
        db,
        referenceDataClient: fakeReferenceDataClient(),
        authenticationContext: authenticationContext(),
        vesselId: VESSEL_ID
      })

      expect(response).toEqual({ vesselId: VESSEL_ID, [field]: [] })
    })

    test('add rejects a missing reference id', async () => {
      const db = buildFakeDb()

      await expect(
        add({
          db,
          referenceDataClient: fakeReferenceDataClient(),
          authenticationContext: authenticationContext(),
          vesselId: VESSEL_ID,
          [idField]: ''
        })
      ).rejects.toSatisfy(isApplicationError)
    })

    test('add rejects a request already in progress for the same Idempotency-Key', async () => {
      const db = buildFakeDb()
      const idempotencyResourceSuffix = idField.replace('Id', '')
      const fingerprint = computeRequestFingerprint({
        operationScope: IDEMPOTENCY_OPERATION_SCOPES.ADD_FAVOURITE,
        idempotencyKey: 'client-key-1',
        allowedFields: ['vesselId', 'id'],
        semanticInput: { vesselId: VESSEL_ID, id: exampleId }
      })
      await db.collections['catch-idempotency-claims'].insertOne({
        ownerUserId: OWNER_USER_ID,
        operationScope: IDEMPOTENCY_OPERATION_SCOPES.ADD_FAVOURITE,
        idempotencyKey: 'client-key-1',
        resourceId: `${VESSEL_ID}:${idempotencyResourceSuffix}`,
        fingerprint,
        state: 'PENDING',
        createdAt: new Date().toISOString()
      })

      await expect(
        add({
          db,
          referenceDataClient: fakeReferenceDataClient(),
          authenticationContext: authenticationContext(),
          vesselId: VESSEL_ID,
          [idField]: exampleId,
          idempotencyKey: 'client-key-1'
        })
      ).rejects.toSatisfy(isApplicationError)
    })

    test('add validates the reference, then persists and returns the updated list', async () => {
      const db = buildFakeDb()
      const referenceDataClient = fakeReferenceDataClient()

      const response = await add({
        db,
        referenceDataClient,
        authenticationContext: authenticationContext(),
        vesselId: VESSEL_ID,
        [idField]: exampleId
      })

      expect(response).toEqual({ vesselId: VESSEL_ID, [field]: [exampleId] })
    })

    test('add is idempotent - repeating the same addition does not duplicate the ID', async () => {
      const db = buildFakeDb()
      const referenceDataClient = fakeReferenceDataClient()
      const input = {
        db,
        referenceDataClient,
        authenticationContext: authenticationContext(),
        vesselId: VESSEL_ID,
        [idField]: exampleId
      }

      await add(input)
      const response = await add(input)

      expect(response).toEqual({ vesselId: VESSEL_ID, [field]: [exampleId] })
    })

    test('add rejects an inactive/unknown reference as a business validation failure', async () => {
      const db = buildFakeDb()
      const referenceDataClient = fakeReferenceDataClient()
      for (const method of ['getGearById', 'getSpeciesById', 'getPortById']) {
        referenceDataClient[method] = vi.fn(async (id) => ({
          id,
          code: 'X',
          name: 'X',
          faoCode: 'X',
          scientificName: 'X',
          commonNames: [],
          active: false
        }))
      }

      await expect(
        add({
          db,
          referenceDataClient,
          authenticationContext: authenticationContext(),
          vesselId: VESSEL_ID,
          [idField]: exampleId
        })
      ).rejects.toSatisfy(isApplicationError)
    })

    test('add denies a vessel the caller cannot access, without mutating the profile', async () => {
      const db = buildFakeDb()
      const referenceDataClient = fakeReferenceDataClient({
        accessibleVesselIds: [OTHER_VESSEL_ID]
      })

      await expect(
        add({
          db,
          referenceDataClient,
          authenticationContext: authenticationContext(),
          vesselId: VESSEL_ID,
          [idField]: exampleId
        })
      ).rejects.toSatisfy(isApplicationError)

      expect(db.collections['vessel-profiles']._store.size).toBe(0)
    })

    test('add reuses an Idempotency-Key replay without a second reference-data lookup', async () => {
      const db = buildFakeDb()
      const referenceDataClient = fakeReferenceDataClient()
      const input = {
        db,
        referenceDataClient,
        authenticationContext: authenticationContext(),
        vesselId: VESSEL_ID,
        [idField]: exampleId,
        idempotencyKey: 'client-key-1'
      }

      await add(input)
      const lookupCountAfterFirst =
        referenceDataClient.getGearById.mock.calls.length +
        referenceDataClient.getSpeciesById.mock.calls.length +
        referenceDataClient.getPortById.mock.calls.length

      const response = await add(input)
      const lookupCountAfterReplay =
        referenceDataClient.getGearById.mock.calls.length +
        referenceDataClient.getSpeciesById.mock.calls.length +
        referenceDataClient.getPortById.mock.calls.length

      expect(lookupCountAfterReplay).toBe(lookupCountAfterFirst)
      expect(response).toEqual({ vesselId: VESSEL_ID, [field]: [exampleId] })
    })

    test('remove is safe to repeat and never creates a profile', async () => {
      const db = buildFakeDb()

      await remove({
        db,
        referenceDataClient: fakeReferenceDataClient(),
        authenticationContext: authenticationContext(),
        vesselId: VESSEL_ID,
        [idField]: exampleId
      })

      expect(db.collections['vessel-profiles']._store.size).toBe(0)
    })

    test('remove removes an existing favourite and is safe to repeat', async () => {
      const db = buildFakeDb()
      const referenceDataClient = fakeReferenceDataClient()
      const base = {
        db,
        referenceDataClient,
        authenticationContext: authenticationContext(),
        vesselId: VESSEL_ID,
        [idField]: exampleId
      }

      await add(base)
      await remove(base)
      const secondRemove = await remove(base)

      expect(secondRemove).toBeUndefined()
      const listResponse = await list({
        db,
        referenceDataClient,
        authenticationContext: authenticationContext(),
        vesselId: VESSEL_ID
      })
      expect(listResponse[field]).toEqual([])
    })

    test('remove denies a vessel the caller cannot access', async () => {
      const db = buildFakeDb()
      const referenceDataClient = fakeReferenceDataClient({
        accessibleVesselIds: [OTHER_VESSEL_ID]
      })

      await expect(
        remove({
          db,
          referenceDataClient,
          authenticationContext: authenticationContext(),
          vesselId: VESSEL_ID,
          [idField]: exampleId
        })
      ).rejects.toSatisfy(isApplicationError)
    })
  }
)
