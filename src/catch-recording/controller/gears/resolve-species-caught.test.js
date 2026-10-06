import { resolveSpeciesCaught } from './resolve-species-caught.js'

function fakeReferenceDataClient(overrides = {}) {
  return {
    getSpeciesById: vi.fn(async (id) => ({
      id,
      faoCode: 'COD',
      scientificName: 'Gadus morhua',
      commonNames: [{ id: 'cn-1', countryCode: 'GB', name: 'Atlantic Cod' }],
      active: true
    })),
    ...overrides
  }
}

describe('#resolveSpeciesCaught', () => {
  test('resolves a species entry, discarding any client-supplied snapshot', async () => {
    const client = fakeReferenceDataClient()
    const issues = []

    const resolved = await resolveSpeciesCaught({
      speciesCaught: [
        {
          id: 'species-1',
          name: 'FORGED',
          faoCode: 'FORGED',
          weightAboveMinimumKg: 120.5,
          weightBelowMinimumKg: null,
          weightLegallyDiscardedKg: null,
          weightPrecision: 'oneDecimalPlace'
        }
      ],
      gearIndex: 0,
      referenceDataClient: client,
      correlationId: 'correlation-1',
      issues
    })

    expect(resolved).toEqual([
      {
        id: 'species-1',
        faoCodeSnapshot: 'COD',
        nameSnapshot: 'Atlantic Cod',
        weightAboveMinimumKg: 120.5,
        weightBelowMinimumKg: null,
        weightLegallyDiscardedKg: null,
        weightPrecision: 'oneDecimalPlace'
      }
    ])
    expect(issues).toEqual([])
    expect(client.getSpeciesById).toHaveBeenCalledWith('species-1', {
      correlationId: 'correlation-1'
    })
  })

  test('omits a weight field/weightPrecision the caller did not supply', async () => {
    const client = fakeReferenceDataClient()
    const issues = []

    const resolved = await resolveSpeciesCaught({
      speciesCaught: [{ id: 'species-1' }],
      gearIndex: 0,
      referenceDataClient: client,
      issues
    })

    expect(resolved).toEqual([
      { id: 'species-1', faoCodeSnapshot: 'COD', nameSnapshot: 'Atlantic Cod' }
    ])
  })

  test('preserves deterministic ordering across multiple species entries', async () => {
    const client = fakeReferenceDataClient()
    const issues = []

    const resolved = await resolveSpeciesCaught({
      speciesCaught: [{ id: 'first' }, { id: 'second' }],
      gearIndex: 0,
      referenceDataClient: client,
      issues
    })

    expect(resolved.map((entry) => entry.id)).toEqual(['first', 'second'])
  })

  test('treats a non-array speciesCaught defensively as an empty collection', async () => {
    const client = fakeReferenceDataClient()

    await expect(
      resolveSpeciesCaught({
        speciesCaught: undefined,
        gearIndex: 0,
        referenceDataClient: client,
        issues: []
      })
    ).resolves.toEqual([])
    await expect(
      resolveSpeciesCaught({
        speciesCaught: null,
        gearIndex: 0,
        referenceDataClient: client,
        issues: []
      })
    ).resolves.toEqual([])
  })

  test('appends one issue for a missing species id', async () => {
    const client = fakeReferenceDataClient()
    const issues = []

    const resolved = await resolveSpeciesCaught({
      speciesCaught: [{}],
      gearIndex: 1,
      referenceDataClient: client,
      issues
    })

    expect(resolved).toEqual([])
    expect(issues).toHaveLength(1)
    expect(issues[0].code).toBe('REQUIRED')
    expect(issues[0].path).toBe('gears.1.speciesCaught.0.id')
  })

  test('appends one issue for an inactive/not-found species', async () => {
    const { ApplicationError } =
      await import('#/common/helpers/errors/application-error.js')
    const client = {
      getSpeciesById: vi.fn(async () => {
        throw new ApplicationError({
          category: 'RESOURCE_NOT_FOUND',
          message: 'The selected species could not be found.'
        })
      })
    }
    const issues = []

    const resolved = await resolveSpeciesCaught({
      speciesCaught: [{ id: 'missing' }],
      gearIndex: 0,
      referenceDataClient: client,
      issues
    })

    expect(resolved).toEqual([])
    expect(issues).toHaveLength(1)
    expect(issues[0].code).toBe('INVALID_REFERENCE')
  })

  test('rethrows an upstream dependency failure unchanged', async () => {
    const { ApplicationError } =
      await import('#/common/helpers/errors/application-error.js')
    const client = {
      getSpeciesById: vi.fn(async () => {
        throw new ApplicationError({
          category: 'UPSTREAM_TIMEOUT',
          message: 'The reference data service timed out.'
        })
      })
    }

    await expect(
      resolveSpeciesCaught({
        speciesCaught: [{ id: 'species-1' }],
        gearIndex: 0,
        referenceDataClient: client,
        issues: []
      })
    ).rejects.toMatchObject({ category: 'UPSTREAM_TIMEOUT' })
  })

  test('does not mutate the supplied speciesCaught input', async () => {
    const client = fakeReferenceDataClient()
    const input = Object.freeze([
      Object.freeze({ id: 'species-1', weightAboveMinimumKg: 120.5 })
    ])

    await expect(
      resolveSpeciesCaught({
        speciesCaught: input,
        gearIndex: 0,
        referenceDataClient: client,
        issues: []
      })
    ).resolves.toBeDefined()
    expect(input[0]).toEqual({ id: 'species-1', weightAboveMinimumKg: 120.5 })
  })

  test('aggregates multiple issues across the collection into the shared issues array', async () => {
    const client = fakeReferenceDataClient()
    const issues = []

    await resolveSpeciesCaught({
      speciesCaught: [{}, {}],
      gearIndex: 0,
      referenceDataClient: client,
      issues
    })

    expect(issues).toHaveLength(2)
  })
})
