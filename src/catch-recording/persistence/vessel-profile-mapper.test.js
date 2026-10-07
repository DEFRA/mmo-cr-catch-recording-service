import { toCanonicalProfile } from './vessel-profile-mapper.js'

describe('#vessel-profile-mapper', () => {
  test('Should default every array when no document exists', () => {
    expect(toCanonicalProfile(null, 'vessel-1')).toEqual({
      vesselId: 'vessel-1',
      favouriteGearIds: [],
      favouriteSpeciesIds: [],
      favouritePortIds: [],
      skippers: []
    })
  })

  test('Should map a stored document, exposing only public skipper fields', () => {
    const document = {
      _id: 'vessel-1',
      favouriteGearIds: ['gear-1'],
      favouriteSpeciesIds: ['species-1'],
      favouritePortIds: [],
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
    }

    const profile = toCanonicalProfile(document, 'vessel-1')

    expect(profile).toEqual({
      vesselId: 'vessel-1',
      favouriteGearIds: ['gear-1'],
      favouriteSpeciesIds: ['species-1'],
      favouritePortIds: [],
      skippers: [
        {
          id: 'skipper-1',
          name: 'Jane Doe',
          phoneNumber: '01234',
          email: 'jane@example.com'
        }
      ]
    })
    expect(profile.skippers[0]).not.toHaveProperty('normalisedName')
    expect(profile.skippers[0]).not.toHaveProperty('createdAt')
    expect(profile.skippers[0]).not.toHaveProperty('createdBy')
  })

  test('Should default a skipper with no phone/email to null', () => {
    const document = {
      _id: 'vessel-1',
      skippers: [
        { id: 'skipper-1', name: 'Jane Doe', normalisedName: 'jane doe' }
      ]
    }

    const profile = toCanonicalProfile(document, 'vessel-1')

    expect(profile.skippers[0]).toEqual({
      id: 'skipper-1',
      name: 'Jane Doe',
      phoneNumber: null,
      email: null
    })
  })

  test('Should return a frozen, independently-copied structure', () => {
    const document = { _id: 'vessel-1', favouriteGearIds: ['gear-1'] }

    const profile = toCanonicalProfile(document, 'vessel-1')

    expect(Object.isFrozen(profile)).toBe(true)
    expect(Object.isFrozen(profile.favouriteGearIds)).toBe(true)
    document.favouriteGearIds.push('gear-2')
    expect(profile.favouriteGearIds).toEqual(['gear-1'])
  })
})
