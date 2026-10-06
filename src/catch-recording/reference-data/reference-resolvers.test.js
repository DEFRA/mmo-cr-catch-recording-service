import {
  resolvePort,
  resolveGear,
  resolveStatisticalArea,
  resolveSpecies,
  resolveGearCharacteristic
} from './reference-resolvers.js'
import { ApplicationError } from '#/common/helpers/errors/application-error.js'

function notFoundError() {
  return new ApplicationError({
    category: 'RESOURCE_NOT_FOUND',
    message: 'not found'
  })
}

function dependencyError(category = 'UPSTREAM_TIMEOUT') {
  return new ApplicationError({ category, message: 'dependency failure' })
}

describe('#resolvePort', () => {
  const activePort = {
    id: 'port-1',
    code: '0349',
    name: 'Plymouth',
    active: true
  }

  test('Should resolve an active port with its snapshot', async () => {
    const client = { getPortById: vi.fn().mockResolvedValue(activePort) }

    const { result, snapshot } = await resolvePort({
      id: 'port-1',
      path: ['trip', 'departurePort'],
      client
    })

    expect(result.valid).toBe(true)
    expect(snapshot).toEqual({
      codeSnapshot: '0349',
      nameSnapshot: 'Plymouth'
    })
  })

  test('Should deny with REQUIRED for a missing id without calling Step 15', async () => {
    const client = { getPortById: vi.fn() }

    const { result } = await resolvePort({
      id: undefined,
      path: ['trip', 'departurePort'],
      client
    })

    expect(result.valid).toBe(false)
    expect(result.issues[0].code).toBe('REQUIRED')
    expect(result.issues[0].path).toBe('trip.departurePort.id')
    expect(client.getPortById).not.toHaveBeenCalled()
  })

  test('Should deny with INVALID_STRUCTURE for a malformed id', async () => {
    const client = { getPortById: vi.fn() }

    const { result } = await resolvePort({
      id: 42,
      path: ['trip', 'departurePort'],
      client
    })

    expect(result.issues[0].code).toBe('INVALID_STRUCTURE')
    expect(client.getPortById).not.toHaveBeenCalled()
  })

  test('Should translate a 404 into an INVALID_REFERENCE business issue, not a rethrown error', async () => {
    const client = {
      getPortById: vi.fn().mockRejectedValue(notFoundError())
    }

    const { result, snapshot } = await resolvePort({
      id: 'port-1',
      path: ['trip', 'departurePort'],
      client
    })

    expect(result.valid).toBe(false)
    expect(result.issues[0].code).toBe('INVALID_REFERENCE')
    expect(snapshot).toBeNull()
  })

  test('Should deny with INVALID_REFERENCE for an inactive port', async () => {
    const client = {
      getPortById: vi.fn().mockResolvedValue({ ...activePort, active: false })
    }

    const { result } = await resolvePort({
      id: 'port-1',
      path: ['trip', 'departurePort'],
      client
    })

    expect(result.issues[0].code).toBe('INVALID_REFERENCE')
  })

  test.each([
    'UPSTREAM_TIMEOUT',
    'DEPENDENCY_UNAVAILABLE',
    'UPSTREAM_INVALID_RESPONSE'
  ])(
    'Should rethrow a %s dependency failure unchanged, never converting it to a validation issue',
    async (category) => {
      const client = {
        getPortById: vi.fn().mockRejectedValue(dependencyError(category))
      }

      await expect(
        resolvePort({ id: 'port-1', path: ['trip', 'departurePort'], client })
      ).rejects.toMatchObject({ category })
    }
  )
})

describe('#resolveGear', () => {
  test('Should resolve an active gear with its snapshot and expose resolved.characteristics', async () => {
    const gear = {
      id: 'gear-1',
      code: 'TBB',
      name: 'Beam Trawl',
      active: true,
      characteristics: [{ characteristicId: 'char-1', name: 'Mesh Size' }]
    }
    const client = { getGearById: vi.fn().mockResolvedValue(gear) }

    const { result, snapshot, resolved } = await resolveGear({
      id: 'gear-1',
      path: ['gears', 0, 'gear'],
      client
    })

    expect(result.valid).toBe(true)
    expect(snapshot).toEqual({
      codeSnapshot: 'TBB',
      nameSnapshot: 'Beam Trawl'
    })
    expect(resolved.characteristics).toHaveLength(1)
  })
})

describe('#resolveStatisticalArea', () => {
  test('Should treat every resolved statistical area as active - no active check applies', async () => {
    const area = { id: 'area-1', code: '46F45', name: 'ICES 46F45' }
    const client = {
      getStatisticalAreaById: vi.fn().mockResolvedValue(area)
    }

    const { result, snapshot } = await resolveStatisticalArea({
      id: 'area-1',
      path: ['gears', 0, 'statisticalArea'],
      client
    })

    expect(result.valid).toBe(true)
    expect(snapshot).toEqual({
      codeSnapshot: '46F45',
      nameSnapshot: 'ICES 46F45'
    })
  })
})

describe('#resolveSpecies', () => {
  test('Should resolve an active species with its snapshot', async () => {
    const species = {
      id: 'species-1',
      faoCode: 'COD',
      scientificName: 'Gadus morhua',
      commonNames: [{ name: 'Atlantic Cod' }],
      active: true
    }
    const client = { getSpeciesById: vi.fn().mockResolvedValue(species) }

    const { result, snapshot } = await resolveSpecies({
      id: 'species-1',
      path: ['gears', 0, 'speciesCaught', 0, 'species'],
      client
    })

    expect(result.valid).toBe(true)
    expect(snapshot).toEqual({
      faoCodeSnapshot: 'COD',
      nameSnapshot: 'Atlantic Cod'
    })
  })

  test('Should deny an inactive species', async () => {
    const client = {
      getSpeciesById: vi.fn().mockResolvedValue({
        id: 'species-1',
        faoCode: 'COD',
        scientificName: 'Gadus morhua',
        commonNames: [],
        active: false
      })
    }

    const { result } = await resolveSpecies({
      id: 'species-1',
      path: ['gears', 0, 'speciesCaught', 0, 'species'],
      client
    })

    expect(result.issues[0].code).toBe('INVALID_REFERENCE')
  })
})

describe('#resolveGearCharacteristic', () => {
  const gear = {
    characteristics: [
      { characteristicId: 'char-1', name: 'Mesh Size', unit: 'mm' }
    ]
  }

  test('Should resolve a characteristic that belongs to the gear', () => {
    const { result, snapshot } = resolveGearCharacteristic({
      characteristicId: 'char-1',
      path: ['gears', 0, 'characteristics', 0],
      gear
    })

    expect(result.valid).toBe(true)
    expect(snapshot).toEqual({ nameSnapshot: 'Mesh Size', unitSnapshot: 'mm' })
  })

  test('Should deny a characteristic that does not belong to the gear', () => {
    const { result } = resolveGearCharacteristic({
      characteristicId: 'char-does-not-exist',
      path: ['gears', 0, 'characteristics', 0],
      gear
    })

    expect(result.valid).toBe(false)
    expect(result.issues[0].code).toBe('INVALID_REFERENCE')
  })

  test('Should deny a missing characteristic id', () => {
    const { result } = resolveGearCharacteristic({
      characteristicId: undefined,
      path: ['gears', 0, 'characteristics', 0],
      gear
    })

    expect(result.issues[0].code).toBe('REQUIRED')
  })

  test('Should deny a malformed characteristic id', () => {
    const { result } = resolveGearCharacteristic({
      characteristicId: 42,
      path: ['gears', 0, 'characteristics', 0],
      gear
    })

    expect(result.issues[0].code).toBe('INVALID_STRUCTURE')
  })

  test('Should not allow a different gear association to cross-contaminate resolution', () => {
    const otherGear = { characteristics: [] }

    const { result } = resolveGearCharacteristic({
      characteristicId: 'char-1',
      path: ['gears', 1, 'characteristics', 0],
      gear: otherGear
    })

    expect(result.valid).toBe(false)
  })
})
