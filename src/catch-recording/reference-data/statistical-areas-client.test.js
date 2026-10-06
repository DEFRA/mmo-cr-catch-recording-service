import { createGetStatisticalAreaById } from './statistical-areas-client.js'

function validFeatureBody(overrides = {}) {
  return {
    type: 'Feature',
    id: 'area-1',
    properties: {
      id: 'area-1',
      code: '46F45',
      name: 'ICES 46F45',
      areaType: 'ICES',
      parentCode: null,
      parentName: null,
      areaKm2: 1234.5
    },
    geometry: { type: 'Polygon', coordinates: [] },
    ...overrides
  }
}

function fakeHttpClient(response) {
  return { get: vi.fn().mockResolvedValue(response) }
}

describe('#createGetStatisticalAreaById', () => {
  test('Should return the validated, frozen statistical area for a valid response', async () => {
    const httpClient = fakeHttpClient({
      status: 200,
      body: validFeatureBody()
    })
    const getStatisticalAreaById = createGetStatisticalAreaById({
      httpClient
    })

    const area = await getStatisticalAreaById('area-1')

    expect(area.code).toBe('46F45')
    expect(area.name).toBe('ICES 46F45')
    expect(area.geometry).toEqual({ type: 'Polygon', coordinates: [] })
    expect(Object.isFrozen(area)).toBe(true)
  })

  test('Should reject an invalid id without a network call', async () => {
    const httpClient = fakeHttpClient({})
    const getStatisticalAreaById = createGetStatisticalAreaById({
      httpClient
    })

    await expect(getStatisticalAreaById('')).rejects.toThrow()
    expect(httpClient.get).not.toHaveBeenCalled()
  })

  test('Should raise UPSTREAM_INVALID_RESPONSE for an unexpected status', async () => {
    const httpClient = fakeHttpClient({ status: 500, body: null })
    const getStatisticalAreaById = createGetStatisticalAreaById({
      httpClient
    })

    try {
      await getStatisticalAreaById('area-1')
      throw new Error('expected getStatisticalAreaById to reject')
    } catch (error) {
      expect(error.category).toBe('UPSTREAM_INVALID_RESPONSE')
    }
  })

  test('Should raise RESOURCE_NOT_FOUND for a 404', async () => {
    const httpClient = fakeHttpClient({ status: 404, body: null })
    const getStatisticalAreaById = createGetStatisticalAreaById({
      httpClient
    })

    try {
      await getStatisticalAreaById('area-1')
      throw new Error('expected getStatisticalAreaById to reject')
    } catch (error) {
      expect(error.category).toBe('RESOURCE_NOT_FOUND')
    }
  })

  test.each([
    ['missing root', null],
    ['not a Feature', validFeatureBody({ type: 'FeatureCollection' })],
    ['missing properties', validFeatureBody({ properties: undefined })],
    [
      'missing properties.code',
      validFeatureBody({
        properties: { id: 'area-1', name: 'x', areaType: 'ICES' }
      })
    ],
    ['missing geometry', validFeatureBody({ geometry: undefined })],
    [
      'wrong-type areaKm2',
      {
        ...validFeatureBody(),
        properties: { ...validFeatureBody().properties, areaKm2: 'big' }
      }
    ]
  ])('Should reject a malformed response: %s', async (_label, body) => {
    const httpClient = fakeHttpClient({ status: 200, body })
    const getStatisticalAreaById = createGetStatisticalAreaById({
      httpClient
    })

    try {
      await getStatisticalAreaById('area-1')
      throw new Error('expected getStatisticalAreaById to reject')
    } catch (error) {
      expect(error.category).toBe('UPSTREAM_INVALID_RESPONSE')
    }
  })

  test('Should treat every returned statistical area as active - there is no active-selection field', async () => {
    const httpClient = fakeHttpClient({
      status: 200,
      body: validFeatureBody()
    })
    const getStatisticalAreaById = createGetStatisticalAreaById({
      httpClient
    })

    const area = await getStatisticalAreaById('area-1')

    expect(area).not.toHaveProperty('active')
  })
})
