import { createGetVesselById } from './vessels-client.js'
import { isApplicationError } from '#/common/helpers/errors/application-error.js'

function validVesselBody(overrides = {}) {
  return {
    id: 'vessel-1',
    name: 'Example Vessel',
    namePln: null,
    identifiers: {
      cfr: 'GBR000A12345',
      uvi: null,
      mmsi: null,
      ircs: null,
      externalMark: 'PZ1',
      registrationNumber: 'R12345'
    },
    lengthOverallMetres: 9.5,
    status: 'active',
    activeFrom: '2020-01-01',
    activeTo: null,
    ...overrides
  }
}

function fakeHttpClient(response) {
  return { get: vi.fn().mockResolvedValue(response) }
}

describe('#createGetVesselById', () => {
  test('Should return the validated, frozen vessel for a valid response', async () => {
    const httpClient = fakeHttpClient({ status: 200, body: validVesselBody() })
    const getVesselById = createGetVesselById({ httpClient })

    const vessel = await getVesselById('vessel-1')

    expect(vessel.id).toBe('vessel-1')
    expect(vessel.identifiers.externalMark).toBe('PZ1')
    expect(Object.isFrozen(vessel)).toBe(true)
    expect(Object.isFrozen(vessel.identifiers)).toBe(true)
  })

  test('Should request the correctly encoded path', async () => {
    const httpClient = fakeHttpClient({ status: 200, body: validVesselBody() })
    const getVesselById = createGetVesselById({ httpClient })

    await getVesselById('vessel 1', { correlationId: 'trace-1' })

    expect(httpClient.get).toHaveBeenCalledWith({
      path: '/api/v1/reference-data/vessels/vessel%201',
      correlationId: 'trace-1'
    })
  })

  test('Should reject an invalid id without calling the HTTP client', async () => {
    const httpClient = fakeHttpClient({})
    const getVesselById = createGetVesselById({ httpClient })

    await expect(getVesselById('')).rejects.toSatisfy(isApplicationError)
    expect(httpClient.get).not.toHaveBeenCalled()
  })

  test('Should raise RESOURCE_NOT_FOUND for a 404', async () => {
    const httpClient = fakeHttpClient({ status: 404, body: null })
    const getVesselById = createGetVesselById({ httpClient })

    try {
      await getVesselById('vessel-1')
      throw new Error('expected getVesselById to reject')
    } catch (error) {
      expect(error.category).toBe('RESOURCE_NOT_FOUND')
    }
  })

  test('Should raise UPSTREAM_INVALID_RESPONSE for an unexpected status', async () => {
    const httpClient = fakeHttpClient({ status: 500, body: null })
    const getVesselById = createGetVesselById({ httpClient })

    try {
      await getVesselById('vessel-1')
      throw new Error('expected getVesselById to reject')
    } catch (error) {
      expect(error.category).toBe('UPSTREAM_INVALID_RESPONSE')
    }
  })

  test.each([
    ['missing root', null],
    ['missing id', validVesselBody({ id: undefined })],
    ['non-string id', validVesselBody({ id: 42 })],
    ['missing name', validVesselBody({ name: undefined })],
    [
      'wrong-type lengthOverallMetres',
      validVesselBody({ lengthOverallMetres: '9.5' })
    ],
    ['missing identifiers', validVesselBody({ identifiers: undefined })],
    ['invalid identifiers shape', validVesselBody({ identifiers: 'x' })],
    [
      'invalid identifier field type',
      validVesselBody({ identifiers: { cfr: 42 } })
    ],
    ['missing status', validVesselBody({ status: undefined })],
    ['missing activeFrom', validVesselBody({ activeFrom: undefined })],
    ['wrong-type activeTo', validVesselBody({ activeTo: 42 })]
  ])('Should reject a malformed response: %s', async (_label, body) => {
    const httpClient = fakeHttpClient({ status: 200, body })
    const getVesselById = createGetVesselById({ httpClient })

    try {
      await getVesselById('vessel-1')
      throw new Error('expected getVesselById to reject')
    } catch (error) {
      expect(error.category).toBe('UPSTREAM_INVALID_RESPONSE')
    }
  })

  test('Should ignore unknown extra fields rather than propagate them', async () => {
    const httpClient = fakeHttpClient({
      status: 200,
      body: validVesselBody({ secretInternalField: 'SENTINEL' })
    })
    const getVesselById = createGetVesselById({ httpClient })

    const vessel = await getVesselById('vessel-1')

    expect(JSON.stringify(vessel)).not.toContain('SENTINEL')
  })

  test('Should not mutate the raw response body', async () => {
    const body = validVesselBody()
    const frozenBody = Object.freeze(body)
    const httpClient = fakeHttpClient({ status: 200, body: frozenBody })
    const getVesselById = createGetVesselById({ httpClient })

    await expect(getVesselById('vessel-1')).resolves.toBeDefined()
  })
})
