import {
  getVesselProfileCollection,
  ensureVesselProfileIndexes,
  VESSEL_PROFILE_COLLECTION
} from './vessel-profile-collection.js'

describe('#vessel-profile-collection', () => {
  test('Should resolve the approved collection name', () => {
    const db = { collection: vi.fn().mockReturnValue('the-collection') }

    const result = getVesselProfileCollection(db)

    expect(db.collection).toHaveBeenCalledExactlyOnceWith('vessel-profiles')
    expect(result).toBe('the-collection')
    expect(VESSEL_PROFILE_COLLECTION).toBe('vessel-profiles')
  })

  test('Should not create any index beyond the automatic unique _id index', async () => {
    const db = {}

    await expect(ensureVesselProfileIndexes(db)).resolves.toBeUndefined()
  })
})
