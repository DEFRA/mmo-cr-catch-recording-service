import { createGetSpeciesById } from './species-client.js'

function validSpeciesBody(overrides = {}) {
  return {
    id: 'species-1',
    faoCode: 'COD',
    scientificName: 'Gadus morhua',
    commonNames: [{ id: 'cn-1', countryCode: 'GB', name: 'Atlantic Cod' }],
    localNames: [
      { id: 'ln-1', languageCode: 'en-GB', name: 'Cod', official: true }
    ],
    active: true,
    ...overrides
  }
}

function fakeHttpClient(response) {
  return { get: vi.fn().mockResolvedValue(response) }
}

describe('#createGetSpeciesById', () => {
  test('Should return the validated, frozen species for a valid response', async () => {
    const httpClient = fakeHttpClient({
      status: 200,
      body: validSpeciesBody()
    })
    const getSpeciesById = createGetSpeciesById({ httpClient })

    const species = await getSpeciesById('species-1')

    expect(species.faoCode).toBe('COD')
    expect(species.commonNames[0].name).toBe('Atlantic Cod')
    expect(Object.isFrozen(species)).toBe(true)
    expect(Object.isFrozen(species.commonNames)).toBe(true)
  })

  test('Should accept empty commonNames/localNames arrays', async () => {
    const httpClient = fakeHttpClient({
      status: 200,
      body: validSpeciesBody({ commonNames: [], localNames: [] })
    })
    const getSpeciesById = createGetSpeciesById({ httpClient })

    const species = await getSpeciesById('species-1')

    expect(species.commonNames).toEqual([])
    expect(species.localNames).toEqual([])
  })

  test('Should raise RESOURCE_NOT_FOUND for a 404', async () => {
    const httpClient = fakeHttpClient({ status: 404, body: null })
    const getSpeciesById = createGetSpeciesById({ httpClient })

    try {
      await getSpeciesById('species-1')
      throw new Error('expected getSpeciesById to reject')
    } catch (error) {
      expect(error.category).toBe('RESOURCE_NOT_FOUND')
    }
  })

  test('Should reject an invalid id without a network call', async () => {
    const httpClient = fakeHttpClient({})
    const getSpeciesById = createGetSpeciesById({ httpClient })

    await expect(getSpeciesById('')).rejects.toThrow()
    expect(httpClient.get).not.toHaveBeenCalled()
  })

  test('Should raise UPSTREAM_INVALID_RESPONSE for an unexpected status', async () => {
    const httpClient = fakeHttpClient({ status: 500, body: null })
    const getSpeciesById = createGetSpeciesById({ httpClient })

    try {
      await getSpeciesById('species-1')
      throw new Error('expected getSpeciesById to reject')
    } catch (error) {
      expect(error.category).toBe('UPSTREAM_INVALID_RESPONSE')
    }
  })

  test.each([
    ['missing root', null],
    ['missing faoCode', validSpeciesBody({ faoCode: undefined })],
    [
      'invalid commonNames entry',
      validSpeciesBody({ commonNames: [{ id: 'x' }] })
    ],
    [
      'invalid localNames entry (missing official)',
      validSpeciesBody({
        localNames: [{ id: 'x', languageCode: 'en', name: 'y' }]
      })
    ],
    ['non-array commonNames', validSpeciesBody({ commonNames: 'x' })],
    ['missing active', validSpeciesBody({ active: undefined })]
  ])('Should reject a malformed response: %s', async (_label, body) => {
    const httpClient = fakeHttpClient({ status: 200, body })
    const getSpeciesById = createGetSpeciesById({ httpClient })

    try {
      await getSpeciesById('species-1')
      throw new Error('expected getSpeciesById to reject')
    } catch (error) {
      expect(error.category).toBe('UPSTREAM_INVALID_RESPONSE')
    }
  })
})
