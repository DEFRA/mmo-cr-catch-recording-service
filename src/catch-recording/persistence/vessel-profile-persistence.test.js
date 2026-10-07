import {
  findVesselProfile,
  addFavouriteId,
  removeFavouriteId,
  addSkipper,
  removeSkipper
} from './vessel-profile-persistence.js'
import { VESSEL_PROFILE_COLLECTION } from './vessel-profile-collection.js'

function buildFakeCollection(overrides = {}) {
  return {
    findOne: vi.fn().mockResolvedValue(null),
    findOneAndUpdate: vi.fn().mockResolvedValue(null),
    ...overrides
  }
}

function buildFakeDb(collection) {
  return { collection: vi.fn().mockReturnValue(collection) }
}

function duplicateKeyError() {
  const error = new Error('E11000 duplicate key error')
  error.code = 11000
  return error
}

function unexpectedError() {
  return new Error('connection reset')
}

describe('#vessel-profile-persistence', () => {
  describe('findVesselProfile', () => {
    test('Should return the approved default empty profile when no document exists', async () => {
      const collection = buildFakeCollection()
      const db = buildFakeDb(collection)

      const profile = await findVesselProfile(db, 'vessel-1')

      expect(db.collection).toHaveBeenCalledExactlyOnceWith(
        VESSEL_PROFILE_COLLECTION
      )
      expect(collection.findOne).toHaveBeenCalledExactlyOnceWith({
        _id: 'vessel-1'
      })
      expect(profile).toEqual({
        vesselId: 'vessel-1',
        favouriteGearIds: [],
        favouriteSpeciesIds: [],
        favouritePortIds: [],
        skippers: []
      })
    })

    test('Should map an existing stored document, exposing only public skipper fields', async () => {
      const collection = buildFakeCollection({
        findOne: vi.fn().mockResolvedValue({
          _id: 'vessel-1',
          favouriteGearIds: ['gear-1'],
          favouriteSpeciesIds: [],
          favouritePortIds: ['port-1'],
          skippers: [
            {
              id: 'skipper-1',
              name: 'Jane Doe',
              normalisedName: 'jane doe',
              phoneNumber: '01234',
              email: 'jane@example.com',
              createdAt: '2026-01-01T00:00:00.000Z',
              createdBy: 'owner-1',
              updatedAt: '2026-01-01T00:00:00.000Z',
              updatedBy: 'owner-1'
            }
          ]
        })
      })
      const db = buildFakeDb(collection)

      const profile = await findVesselProfile(db, 'vessel-1')

      expect(profile.skippers).toEqual([
        {
          id: 'skipper-1',
          name: 'Jane Doe',
          phoneNumber: '01234',
          email: 'jane@example.com'
        }
      ])
    })

    test('Should reject a non-string vesselId', async () => {
      const db = buildFakeDb(buildFakeCollection())

      await expect(findVesselProfile(db, '')).rejects.toThrow(TypeError)
    })

    test('Should translate an unexpected driver failure', async () => {
      const collection = buildFakeCollection({
        findOne: vi.fn().mockRejectedValue(unexpectedError())
      })
      const db = buildFakeDb(collection)

      await expect(findVesselProfile(db, 'vessel-1')).rejects.toMatchObject({
        category: 'UNEXPECTED_INTERNAL_FAILURE'
      })
    })
  })

  describe('addFavouriteId', () => {
    function buildParams(overrides = {}) {
      return {
        vesselId: 'vessel-1',
        field: 'favouriteGearIds',
        id: 'gear-1',
        actorUserId: 'owner-1',
        now: '2026-01-01T00:00:00.000Z',
        ...overrides
      }
    }

    test('Should atomically $addToSet, defaulting every other favourite array and skippers on insert', async () => {
      const collection = buildFakeCollection({
        findOneAndUpdate: vi.fn().mockResolvedValue({
          _id: 'vessel-1',
          favouriteGearIds: ['gear-1'],
          favouriteSpeciesIds: [],
          favouritePortIds: [],
          skippers: []
        })
      })
      const db = buildFakeDb(collection)

      const profile = await addFavouriteId(db, buildParams())

      expect(collection.findOneAndUpdate).toHaveBeenCalledExactlyOnceWith(
        { _id: 'vessel-1' },
        {
          $addToSet: { favouriteGearIds: 'gear-1' },
          $setOnInsert: {
            _id: 'vessel-1',
            favouriteSpeciesIds: [],
            favouritePortIds: [],
            skippers: [],
            createdAt: '2026-01-01T00:00:00.000Z',
            createdBy: 'owner-1'
          },
          $set: {
            updatedAt: '2026-01-01T00:00:00.000Z',
            updatedBy: 'owner-1'
          }
        },
        { upsert: true, returnDocument: 'after' }
      )
      expect(profile.favouriteGearIds).toEqual(['gear-1'])
    })

    test('Should never place the mutated field in $setOnInsert', async () => {
      const collection = buildFakeCollection({
        findOneAndUpdate: vi.fn().mockResolvedValue({
          _id: 'vessel-1',
          favouriteSpeciesIds: ['species-1']
        })
      })
      const db = buildFakeDb(collection)

      await addFavouriteId(
        db,
        buildParams({ field: 'favouriteSpeciesIds', id: 'species-1' })
      )

      const [, updateDocument] = collection.findOneAndUpdate.mock.calls[0]
      expect(updateDocument.$setOnInsert).not.toHaveProperty(
        'favouriteSpeciesIds'
      )
      expect(updateDocument.$setOnInsert).toHaveProperty('favouriteGearIds')
      expect(updateDocument.$setOnInsert).toHaveProperty('favouritePortIds')
    })

    test('Should translate an unexpected driver failure', async () => {
      const collection = buildFakeCollection({
        findOneAndUpdate: vi.fn().mockRejectedValue(unexpectedError())
      })
      const db = buildFakeDb(collection)

      await expect(addFavouriteId(db, buildParams())).rejects.toMatchObject({
        category: 'UNEXPECTED_INTERNAL_FAILURE'
      })
    })
  })

  describe('removeFavouriteId', () => {
    function buildParams(overrides = {}) {
      return {
        vesselId: 'vessel-1',
        field: 'favouritePortIds',
        id: 'port-1',
        actorUserId: 'owner-1',
        now: '2026-01-01T00:00:00.000Z',
        ...overrides
      }
    }

    test('Should atomically $pull without upserting', async () => {
      const collection = buildFakeCollection({
        findOneAndUpdate: vi.fn().mockResolvedValue({
          _id: 'vessel-1',
          favouriteGearIds: [],
          favouriteSpeciesIds: [],
          favouritePortIds: [],
          skippers: []
        })
      })
      const db = buildFakeDb(collection)

      await removeFavouriteId(db, buildParams())

      expect(collection.findOneAndUpdate).toHaveBeenCalledExactlyOnceWith(
        { _id: 'vessel-1' },
        {
          $pull: { favouritePortIds: 'port-1' },
          $set: {
            updatedAt: '2026-01-01T00:00:00.000Z',
            updatedBy: 'owner-1'
          }
        },
        { returnDocument: 'after' }
      )
    })

    test('Should return the default empty profile when no profile document exists (safe no-op)', async () => {
      const db = buildFakeDb(buildFakeCollection())

      const profile = await removeFavouriteId(db, buildParams())

      expect(profile).toEqual({
        vesselId: 'vessel-1',
        favouriteGearIds: [],
        favouriteSpeciesIds: [],
        favouritePortIds: [],
        skippers: []
      })
    })

    test('Should translate an unexpected driver failure', async () => {
      const collection = buildFakeCollection({
        findOneAndUpdate: vi.fn().mockRejectedValue(unexpectedError())
      })
      const db = buildFakeDb(collection)

      await expect(removeFavouriteId(db, buildParams())).rejects.toMatchObject({
        category: 'UNEXPECTED_INTERNAL_FAILURE'
      })
    })
  })

  describe('addSkipper', () => {
    function buildParams(overrides = {}) {
      return {
        vesselId: 'vessel-1',
        skipperId: 'skipper-1',
        name: 'Jane Doe',
        phoneNumber: '01234',
        email: 'jane@example.com',
        actorUserId: 'owner-1',
        now: '2026-01-01T00:00:00.000Z',
        ...overrides
      }
    }

    test('Should atomically push a new skipper using a case-insensitive trimmed-name dedupe filter', async () => {
      const collection = buildFakeCollection({
        findOneAndUpdate: vi.fn().mockResolvedValue({
          _id: 'vessel-1',
          skippers: [
            {
              id: 'skipper-1',
              name: 'Jane Doe',
              normalisedName: 'jane doe',
              phoneNumber: '01234',
              email: 'jane@example.com'
            }
          ]
        })
      })
      const db = buildFakeDb(collection)

      const profile = await addSkipper(db, buildParams())

      expect(collection.findOneAndUpdate).toHaveBeenCalledExactlyOnceWith(
        { _id: 'vessel-1', 'skippers.normalisedName': { $ne: 'jane doe' } },
        {
          $push: {
            skippers: {
              id: 'skipper-1',
              name: 'Jane Doe',
              normalisedName: 'jane doe',
              phoneNumber: '01234',
              email: 'jane@example.com',
              createdAt: '2026-01-01T00:00:00.000Z',
              createdBy: 'owner-1',
              updatedAt: '2026-01-01T00:00:00.000Z',
              updatedBy: 'owner-1'
            }
          },
          $setOnInsert: {
            _id: 'vessel-1',
            favouriteGearIds: [],
            favouriteSpeciesIds: [],
            favouritePortIds: [],
            createdAt: '2026-01-01T00:00:00.000Z',
            createdBy: 'owner-1'
          },
          $set: {
            updatedAt: '2026-01-01T00:00:00.000Z',
            updatedBy: 'owner-1'
          }
        },
        { upsert: true, returnDocument: 'after' }
      )
      expect(profile.skippers).toEqual([
        {
          id: 'skipper-1',
          name: 'Jane Doe',
          phoneNumber: '01234',
          email: 'jane@example.com'
        }
      ])
    })

    test('Should treat case-insensitive, trimmed duplicate names as an idempotent no-op', async () => {
      const existingDocument = {
        _id: 'vessel-1',
        skippers: [
          {
            id: 'skipper-1',
            name: 'Jane Doe',
            normalisedName: 'jane doe',
            phoneNumber: null,
            email: null
          }
        ]
      }
      const collection = buildFakeCollection({
        findOneAndUpdate: vi.fn().mockRejectedValue(duplicateKeyError()),
        findOne: vi.fn().mockResolvedValue(existingDocument)
      })
      const db = buildFakeDb(collection)

      const profile = await addSkipper(
        db,
        buildParams({ name: '  JANE DOE  ' })
      )

      expect(collection.findOneAndUpdate).toHaveBeenCalledTimes(1)
      expect(profile.skippers).toHaveLength(1)
      expect(profile.skippers[0].id).toBe('skipper-1')
    })

    test('Should retry exactly once when the duplicate key is a profile-creation race, not a name collision', async () => {
      const findOneAndUpdate = vi
        .fn()
        .mockRejectedValueOnce(duplicateKeyError())
        .mockResolvedValueOnce({
          _id: 'vessel-1',
          skippers: [
            {
              id: 'skipper-1',
              name: 'Jane Doe',
              normalisedName: 'jane doe',
              phoneNumber: null,
              email: null
            }
          ]
        })
      const collection = buildFakeCollection({
        findOneAndUpdate,
        // The existing document has no matching skipper - the duplicate key was a pure
        // profile-creation race, not a name collision.
        findOne: vi.fn().mockResolvedValue({ _id: 'vessel-1', skippers: [] })
      })
      const db = buildFakeDb(collection)

      const profile = await addSkipper(db, buildParams())

      expect(findOneAndUpdate).toHaveBeenCalledTimes(2)
      expect(profile.skippers).toHaveLength(1)
    })

    test('Should raise an unexpected failure once the bounded retry is exhausted', async () => {
      const collection = buildFakeCollection({
        findOneAndUpdate: vi.fn().mockRejectedValue(duplicateKeyError()),
        findOne: vi.fn().mockResolvedValue({ _id: 'vessel-1', skippers: [] })
      })
      const db = buildFakeDb(collection)

      await expect(addSkipper(db, buildParams())).rejects.toMatchObject({
        category: 'UNEXPECTED_INTERNAL_FAILURE'
      })
      expect(collection.findOneAndUpdate).toHaveBeenCalledTimes(2)
    })

    test('Should translate an unexpected (non-duplicate-key) driver failure', async () => {
      const collection = buildFakeCollection({
        findOneAndUpdate: vi.fn().mockRejectedValue(unexpectedError())
      })
      const db = buildFakeDb(collection)

      await expect(addSkipper(db, buildParams())).rejects.toMatchObject({
        category: 'UNEXPECTED_INTERNAL_FAILURE'
      })
    })

    test('Should reject a missing name', async () => {
      const db = buildFakeDb(buildFakeCollection())

      await expect(addSkipper(db, buildParams({ name: '' }))).rejects.toThrow(
        TypeError
      )
    })
  })

  describe('removeSkipper', () => {
    function buildParams(overrides = {}) {
      return {
        vesselId: 'vessel-1',
        skipperId: 'skipper-1',
        actorUserId: 'owner-1',
        now: '2026-01-01T00:00:00.000Z',
        ...overrides
      }
    }

    test('Should atomically $pull the skipper by id', async () => {
      const collection = buildFakeCollection({
        findOneAndUpdate: vi.fn().mockResolvedValue({
          _id: 'vessel-1',
          favouriteGearIds: [],
          favouriteSpeciesIds: [],
          favouritePortIds: [],
          skippers: []
        })
      })
      const db = buildFakeDb(collection)

      await removeSkipper(db, buildParams())

      expect(collection.findOneAndUpdate).toHaveBeenCalledExactlyOnceWith(
        { _id: 'vessel-1' },
        {
          $pull: { skippers: { id: 'skipper-1' } },
          $set: {
            updatedAt: '2026-01-01T00:00:00.000Z',
            updatedBy: 'owner-1'
          }
        },
        { returnDocument: 'after' }
      )
    })

    test('Should return the default empty profile when no profile document exists (safe no-op)', async () => {
      const db = buildFakeDb(buildFakeCollection())

      const profile = await removeSkipper(db, buildParams())

      expect(profile.skippers).toEqual([])
    })

    test('Should translate an unexpected driver failure', async () => {
      const collection = buildFakeCollection({
        findOneAndUpdate: vi.fn().mockRejectedValue(unexpectedError())
      })
      const db = buildFakeDb(collection)

      await expect(removeSkipper(db, buildParams())).rejects.toMatchObject({
        category: 'UNEXPECTED_INTERNAL_FAILURE'
      })
    })
  })
})
