import { resolveSpeciesNotLandedSection } from './resolve-species-not-landed.js'

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

describe('#resolveSpeciesNotLandedSection', () => {
  test('resolves a species entry, discarding any client-supplied snapshot', async () => {
    const client = fakeReferenceDataClient()

    const resolved = await resolveSpeciesNotLandedSection(
      [
        {
          id: 'species-1',
          name: 'FORGED',
          faoCode: 'FORGED',
          weightLegallyDiscardedKg: 3,
          weightPrecision: 'oneDecimalPlace'
        }
      ],
      client,
      'correlation-1'
    )

    expect(resolved).toEqual([
      {
        id: 'species-1',
        faoCodeSnapshot: 'COD',
        nameSnapshot: 'Atlantic Cod',
        weightLegallyDiscardedKg: 3,
        weightPrecision: 'oneDecimalPlace'
      }
    ])
    expect(client.getSpeciesById).toHaveBeenCalledWith('species-1', {
      correlationId: 'correlation-1'
    })
  })

  test('omits a weight field/weightPrecision the caller did not supply', async () => {
    const client = fakeReferenceDataClient()

    const resolved = await resolveSpeciesNotLandedSection(
      [{ id: 'species-1' }],
      client
    )

    expect(resolved).toEqual([
      { id: 'species-1', faoCodeSnapshot: 'COD', nameSnapshot: 'Atlantic Cod' }
    ])
  })

  test('preserves deterministic ordering across multiple species entries', async () => {
    const client = fakeReferenceDataClient()

    const resolved = await resolveSpeciesNotLandedSection(
      [{ id: 'first' }, { id: 'second' }],
      client
    )

    expect(resolved.map((entry) => entry.id)).toEqual(['first', 'second'])
  })

  test('treats a non-array speciesNotLanded defensively as an empty collection', async () => {
    const client = fakeReferenceDataClient()

    await expect(
      resolveSpeciesNotLandedSection(undefined, client)
    ).resolves.toEqual([])
    await expect(resolveSpeciesNotLandedSection(null, client)).resolves.toEqual(
      []
    )
  })

  test('throws one aggregated BUSINESS_VALIDATION_FAILURE for a missing species id', async () => {
    const client = fakeReferenceDataClient()

    await expect(
      resolveSpeciesNotLandedSection([{}], client)
    ).rejects.toMatchObject({
      category: 'BUSINESS_VALIDATION_FAILURE',
      code: 'SECTION_VALIDATION_FAILED'
    })
  })

  test('throws one aggregated BUSINESS_VALIDATION_FAILURE naming the speciesNotLanded path for a not-found species', async () => {
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

    let thrown
    try {
      await resolveSpeciesNotLandedSection([{ id: 'missing' }], client)
      throw new Error('expected resolveSpeciesNotLandedSection to throw')
    } catch (error) {
      thrown = error
    }

    expect(thrown.category).toBe('BUSINESS_VALIDATION_FAILURE')
    expect(thrown.details).toHaveLength(1)
    expect(thrown.details[0].path).toBe('speciesNotLanded.0.id')
  })

  test('aggregates multiple issues across the collection into a single thrown error', async () => {
    const client = fakeReferenceDataClient()

    let thrown
    try {
      await resolveSpeciesNotLandedSection([{}, {}], client)
      throw new Error('expected resolveSpeciesNotLandedSection to throw')
    } catch (error) {
      thrown = error
    }

    expect(thrown.details).toHaveLength(2)
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
      resolveSpeciesNotLandedSection([{ id: 'species-1' }], client)
    ).rejects.toMatchObject({ category: 'UPSTREAM_TIMEOUT' })
  })

  test('does not mutate the supplied speciesNotLanded input', async () => {
    const client = fakeReferenceDataClient()
    const input = Object.freeze([
      Object.freeze({ id: 'species-1', weightAboveMinimumKg: 120.5 })
    ])

    await expect(
      resolveSpeciesNotLandedSection(input, client)
    ).resolves.toBeDefined()
    expect(input[0]).toEqual({ id: 'species-1', weightAboveMinimumKg: 120.5 })
  })
})
