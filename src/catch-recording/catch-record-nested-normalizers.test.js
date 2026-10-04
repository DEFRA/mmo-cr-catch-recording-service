import { isApplicationError } from '#/common/helpers/errors/application-error.js'

import {
  normalizeGearCharacteristic,
  normalizeGearEntry,
  normalizePairFishing,
  normalizePortSnapshot,
  normalizeRetainedCatch,
  normalizeSpeciesAttribute,
  normalizeSpeciesCaughtEntry,
  normalizeStatisticalArea,
  normalizeTrip,
  normalizeVesselSnapshot
} from './catch-record-nested-normalizers.js'

function buildGearInput(overrides = {}) {
  return {
    gearId: ' gear-1 ',
    associationId: ' assoc-1 ',
    codeSnapshot: 'GN',
    nameSnapshot: 'Gillnet',
    characteristics: [
      { characteristicId: 'char-1', nameSnapshot: 'Mesh size', value: '120mm' }
    ],
    statisticalArea: { id: 'area-1', code: '27', nameSnapshot: 'Area 27' },
    speciesCaught: [
      {
        speciesId: 'species-1',
        faoCodeSnapshot: 'COD',
        nameSnapshot: 'Cod',
        attributes: [
          { attributeId: 'attr-1', nameSnapshot: 'Weight band', value: 'A' }
        ]
      }
    ],
    ...overrides
  }
}

describe('#normalizeVesselSnapshot', () => {
  test('Should produce only the approved canonical fields', () => {
    const result = normalizeVesselSnapshot({
      id: 'vessel-1',
      nameSnapshot: ' Example Vessel ',
      registrationSnapshot: 'REG-1',
      externalMarkSnapshot: 'EM-1',
      lengthOverallMetres: 12.5
    })

    expect(result).toEqual({
      id: 'vessel-1',
      nameSnapshot: 'Example Vessel',
      registrationSnapshot: 'REG-1',
      externalMarkSnapshot: 'EM-1',
      lengthOverallMetres: 12.5
    })
  })

  test('Should reject an invented field', () => {
    try {
      normalizeVesselSnapshot({ id: 'vessel-1', invented: true })
      throw new Error('Expected normalizeVesselSnapshot to throw')
    } catch (error) {
      expect(isApplicationError(error)).toBe(true)
    }
  })

  test('Should return null for a null candidate', () => {
    expect(normalizeVesselSnapshot(null)).toBeNull()
  })

  test('Should not mutate the input candidate', () => {
    const candidate = { id: 'vessel-1', nameSnapshot: ' Example ' }
    const snapshot = { ...candidate }

    normalizeVesselSnapshot(candidate)

    expect(candidate).toEqual(snapshot)
  })
})

describe('#normalizeTrip', () => {
  test('Should preserve departure and return ports independently', () => {
    const result = normalizeTrip({
      startedAndFinishedToday: true,
      dateStarted: '2026-01-01',
      dateEnded: '2026-01-02',
      departurePort: {
        id: 'port-1',
        codeSnapshot: 'GBPLY',
        nameSnapshot: 'Plymouth'
      },
      returnPort: {
        id: 'port-2',
        codeSnapshot: 'GBFAL',
        nameSnapshot: 'Falmouth'
      }
    })

    expect(result.departurePort.id).toBe('port-1')
    expect(result.returnPort.id).toBe('port-2')
    expect(result.departurePort).not.toBe(result.returnPort)
  })

  test('Should return null for a null candidate', () => {
    expect(normalizeTrip(null)).toBeNull()
  })
})

describe('#normalizePortSnapshot', () => {
  test('Should produce canonical port fields', () => {
    expect(
      normalizePortSnapshot({
        id: 'port-1',
        codeSnapshot: 'GBPLY',
        nameSnapshot: 'Plymouth'
      })
    ).toEqual({ id: 'port-1', codeSnapshot: 'GBPLY', nameSnapshot: 'Plymouth' })
  })
})

describe('#normalizePairFishing', () => {
  test('Should produce canonical fields with deterministic boolean handling', () => {
    const result = normalizePairFishing({
      enabled: true,
      pairSkipperFullName: ' Example Skipper ',
      pairVesselRssNumber: 'B99999'
    })

    expect(result).toEqual({
      enabled: true,
      pairSkipperFullName: 'Example Skipper',
      pairVesselRssNumber: 'B99999'
    })
  })

  test('Should preserve approved null detail fields regardless of enabled', () => {
    const result = normalizePairFishing({
      enabled: false,
      pairSkipperFullName: null,
      pairVesselRssNumber: null
    })

    expect(result.pairSkipperFullName).toBeNull()
    expect(result.pairVesselRssNumber).toBeNull()
  })
})

describe('#normalizeGearCharacteristic and #normalizeSpeciesAttribute', () => {
  test('Should preserve the canonical value representation as a string', () => {
    expect(
      normalizeGearCharacteristic({
        characteristicId: 'char-1',
        nameSnapshot: 'Mesh size',
        value: '120mm'
      }).value
    ).toBe('120mm')
  })

  test('Should produce independent objects on separate calls', () => {
    const input = {
      characteristicId: 'char-1',
      nameSnapshot: 'Mesh size',
      value: '120mm'
    }

    const first = normalizeGearCharacteristic(input)
    const second = normalizeGearCharacteristic(input)

    expect(first).not.toBe(second)
  })

  test('Should reject an invented attribute field', () => {
    expect(() =>
      normalizeSpeciesAttribute({ attributeId: 'a1', invented: true })
    ).toThrow()
  })
})

describe('#normalizeStatisticalArea', () => {
  test('Should create an independent object per call', () => {
    const input = { id: 'area-1', code: '27', nameSnapshot: 'Area 27' }

    const first = normalizeStatisticalArea(input)
    const second = normalizeStatisticalArea(input)

    expect(first).not.toBe(second)
    expect(first).toEqual(second)
  })

  test('Should return null for a null candidate', () => {
    expect(normalizeStatisticalArea(null)).toBeNull()
  })
})

describe('#normalizeSpeciesCaughtEntry', () => {
  test('Should normalise nested attributes independently per call', () => {
    const input = {
      speciesId: 'species-1',
      faoCodeSnapshot: 'COD',
      nameSnapshot: 'Cod',
      attributes: [
        { attributeId: 'a1', nameSnapshot: 'Weight band', value: 'A' }
      ]
    }

    const first = normalizeSpeciesCaughtEntry(input)
    const second = normalizeSpeciesCaughtEntry(input)

    expect(first.attributes).not.toBe(second.attributes)
    expect(first.attributes[0]).not.toBe(second.attributes[0])
    expect(first.attributes).toEqual(second.attributes)
  })

  test('Should preserve an empty attributes collection', () => {
    expect(
      normalizeSpeciesCaughtEntry({
        speciesId: 'species-1',
        faoCodeSnapshot: 'COD',
        nameSnapshot: 'Cod',
        attributes: []
      }).attributes
    ).toEqual([])
  })
})

describe('#normalizeGearEntry', () => {
  test('Should distinguish gearId and associationId', () => {
    const result = normalizeGearEntry(buildGearInput())

    expect(result.gearId).toBe('gear-1')
    expect(result.associationId).toBe('assoc-1')
    expect(result.gearId).not.toBe(result.associationId)
  })

  test('Should produce an independent statisticalArea and speciesCaught per gear entry', () => {
    const first = normalizeGearEntry(buildGearInput())
    const second = normalizeGearEntry(
      buildGearInput({
        statisticalArea: { id: 'area-2', code: '28', nameSnapshot: 'Area 28' }
      })
    )

    expect(first.statisticalArea.id).toBe('area-1')
    expect(second.statisticalArea.id).toBe('area-2')
    expect(first.statisticalArea).not.toBe(second.statisticalArea)
    expect(first.speciesCaught).not.toBe(second.speciesCaught)
  })

  test('Should allow the same species identifier under two independently normalised gear entries', () => {
    const first = normalizeGearEntry(buildGearInput())
    const second = normalizeGearEntry(
      buildGearInput({ gearId: 'gear-2', associationId: 'assoc-2' })
    )

    expect(first.speciesCaught[0].speciesId).toBe(
      second.speciesCaught[0].speciesId
    )
    expect(first.speciesCaught[0].attributes).not.toBe(
      second.speciesCaught[0].attributes
    )

    first.speciesCaught[0].attributes.push({ attributeId: 'mutated' })
    expect(second.speciesCaught[0].attributes).toHaveLength(1)
  })

  test('Should preserve characteristics, speciesCaught and attribute order', () => {
    const result = normalizeGearEntry(
      buildGearInput({
        characteristics: [
          { characteristicId: 'c1', nameSnapshot: 'First', value: '1' },
          { characteristicId: 'c2', nameSnapshot: 'Second', value: '2' }
        ]
      })
    )

    expect(result.characteristics.map((c) => c.characteristicId)).toEqual([
      'c1',
      'c2'
    ])
  })

  test('Should reject an invented gear field', () => {
    expect(() =>
      normalizeGearEntry(buildGearInput({ invented: true }))
    ).toThrow()
  })

  test('Should not mutate the input candidate', () => {
    const candidate = buildGearInput()
    const snapshot = JSON.parse(JSON.stringify(candidate))

    normalizeGearEntry(candidate)

    expect(candidate).toEqual(snapshot)
  })
})

describe('#normalizeRetainedCatch', () => {
  test('Should normalise the approved Yes/No answer', () => {
    expect(normalizeRetainedCatch({ answer: 'YES', species: [] }).answer).toBe(
      'YES'
    )
  })

  test('Should shallow-copy each untyped species entry without field mapping', () => {
    const entry = { anything: 'is permitted for now' }
    const result = normalizeRetainedCatch({ answer: 'NO', species: [entry] })

    expect(result.species[0]).toEqual(entry)
    expect(result.species[0]).not.toBe(entry)
  })

  test('Should preserve collection order', () => {
    const result = normalizeRetainedCatch({
      answer: 'YES',
      species: [{ id: 'a' }, { id: 'b' }]
    })

    expect(result.species.map((s) => s.id)).toEqual(['a', 'b'])
  })

  test('Should return null for a null candidate', () => {
    expect(normalizeRetainedCatch(null)).toBeNull()
  })

  test('Should reject an invented retainedCatch field', () => {
    expect(() =>
      normalizeRetainedCatch({ answer: 'YES', species: [], invented: true })
    ).toThrow()
  })
})
