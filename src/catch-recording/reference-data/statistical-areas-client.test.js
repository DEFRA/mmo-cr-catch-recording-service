import { createGetStatisticalAreaById } from './statistical-areas-client.js'

function validFeatureBody(overrides = {}) {
  return {
    type: 'Feature',
    properties: {
      OBJECTID: 101,
      ICESNAME: '46F4',
      sub_code: '46F45',
      SOUTH: 45,
      WEST: 4,
      NORTH: 46,
      EAST: 5,
      AREA_KM2: 1234.5,
      Shape_Leng: 10.1,
      Shape_Area: 20.2
    },
    geometry: { type: 'MultiPolygon', coordinates: [] },
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

    const area = await getStatisticalAreaById('101')

    expect(area.id).toBe('101')
    expect(area.code).toBe('46F45')
    expect(area.name).toBe('46F4')
    expect(area.areaKm2).toBe(1234.5)
    expect(area.geometry).toEqual({ type: 'MultiPolygon', coordinates: [] })
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
      await getStatisticalAreaById('101')
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
      await getStatisticalAreaById('101')
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
      'missing properties.OBJECTID',
      {
        ...validFeatureBody(),
        properties: { ...validFeatureBody().properties, OBJECTID: undefined }
      }
    ],
    [
      'non-integer properties.OBJECTID',
      {
        ...validFeatureBody(),
        properties: { ...validFeatureBody().properties, OBJECTID: 1.5 }
      }
    ],
    [
      'missing properties.sub_code',
      {
        ...validFeatureBody(),
        properties: { ...validFeatureBody().properties, sub_code: undefined }
      }
    ],
    [
      'missing properties.ICESNAME',
      {
        ...validFeatureBody(),
        properties: { ...validFeatureBody().properties, ICESNAME: undefined }
      }
    ],
    [
      'missing properties.AREA_KM2',
      {
        ...validFeatureBody(),
        properties: { ...validFeatureBody().properties, AREA_KM2: undefined }
      }
    ],
    ['missing geometry', validFeatureBody({ geometry: undefined })],
    [
      'wrong-type AREA_KM2',
      {
        ...validFeatureBody(),
        properties: { ...validFeatureBody().properties, AREA_KM2: 'big' }
      }
    ]
  ])('Should reject a malformed response: %s', async (_label, body) => {
    const httpClient = fakeHttpClient({ status: 200, body })
    const getStatisticalAreaById = createGetStatisticalAreaById({
      httpClient
    })

    try {
      await getStatisticalAreaById('101')
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

    const area = await getStatisticalAreaById('101')

    expect(area).not.toHaveProperty('active')
  })
})
