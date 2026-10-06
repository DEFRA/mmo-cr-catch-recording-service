import {
  mapVesselSnapshot,
  mapPortSnapshot,
  mapGearSnapshot,
  mapStatisticalAreaSnapshot,
  mapSpeciesSnapshot,
  mapGearCharacteristicSnapshot
} from './snapshot-mappers.js'

describe('#mapVesselSnapshot', () => {
  test('Should copy exactly the approved Snapshot fields', () => {
    const vessel = Object.freeze({
      id: 'vessel-1',
      name: 'Example Vessel',
      status: 'active',
      identifiers: Object.freeze({
        registrationNumber: 'RSS123456',
        externalMark: 'PH123',
        cfr: 'SOMETHING-SENSITIVE-NOT-COPIED'
      }),
      lengthOverallMetres: 8.74
    })

    const snapshot = mapVesselSnapshot(vessel)

    expect(snapshot).toEqual({
      rssSnapshot: 'RSS123456',
      nameSnapshot: 'Example Vessel',
      externalMarkSnapshot: 'PH123',
      lengthOverallMetresSnapshot: 8.74
    })
    expect(Object.isFrozen(snapshot)).toBe(true)
    expect(snapshot).not.toHaveProperty('status')
    expect(snapshot).not.toHaveProperty('id')
  })
})

describe('#mapPortSnapshot / #mapGearSnapshot / #mapStatisticalAreaSnapshot', () => {
  test.each([
    [mapPortSnapshot, 'port'],
    [mapGearSnapshot, 'gear'],
    [mapStatisticalAreaSnapshot, 'area']
  ])('%s should copy only codeSnapshot/nameSnapshot', (mapper) => {
    const item = Object.freeze({
      id: 'x',
      code: '0349',
      name: 'Plymouth',
      active: true
    })

    const snapshot = mapper(item)

    expect(snapshot).toEqual({
      codeSnapshot: '0349',
      nameSnapshot: 'Plymouth'
    })
    expect(snapshot).not.toHaveProperty('active')
    expect(snapshot).not.toHaveProperty('id')
  })
})

describe('#mapSpeciesSnapshot', () => {
  test('Should use the first common name when present', () => {
    const species = {
      faoCode: 'COD',
      scientificName: 'Gadus morhua',
      commonNames: [{ name: 'Atlantic Cod' }, { name: 'Other Name' }]
    }

    const snapshot = mapSpeciesSnapshot(species)

    expect(snapshot).toEqual({
      faoCodeSnapshot: 'COD',
      nameSnapshot: 'Atlantic Cod'
    })
  })

  test('Should fall back to scientificName when no common name is present', () => {
    const species = {
      faoCode: 'COD',
      scientificName: 'Gadus morhua',
      commonNames: []
    }

    const snapshot = mapSpeciesSnapshot(species)

    expect(snapshot.nameSnapshot).toBe('Gadus morhua')
  })
})

describe('#mapGearCharacteristicSnapshot', () => {
  test('Should copy name and unit, including a null unit', () => {
    expect(
      mapGearCharacteristicSnapshot({ name: 'Mesh Size', unit: 'mm' })
    ).toEqual({ nameSnapshot: 'Mesh Size', unitSnapshot: 'mm' })
    expect(
      mapGearCharacteristicSnapshot({
        name: 'Number of Times Gear Shot',
        unit: null
      })
    ).toEqual({
      nameSnapshot: 'Number of Times Gear Shot',
      unitSnapshot: null
    })
  })
})
