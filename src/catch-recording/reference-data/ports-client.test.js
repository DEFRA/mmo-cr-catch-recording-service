import { createGetPortById } from './ports-client.js'

function validPortBody(overrides = {}) {
  return {
    id: 'port-1',
    code: '0349',
    name: 'Plymouth',
    countryCode: 'GB',
    coordinate: { latitude: 50.37, longitude: -4.14 },
    active: true,
    ...overrides
  }
}

function fakeHttpClient(response) {
  return { get: vi.fn().mockResolvedValue(response) }
}

describe('#createGetPortById', () => {
  test('Should return the validated, frozen port for a valid response', async () => {
    const httpClient = fakeHttpClient({ status: 200, body: validPortBody() })
    const getPortById = createGetPortById({ httpClient })

    const port = await getPortById('port-1')

    expect(port.code).toBe('0349')
    expect(Object.isFrozen(port)).toBe(true)
  })

  test('Should handle a null coordinate', async () => {
    const httpClient = fakeHttpClient({
      status: 200,
      body: validPortBody({ coordinate: null })
    })
    const getPortById = createGetPortById({ httpClient })

    const port = await getPortById('port-1')

    expect(port.coordinate).toBeNull()
  })

  test('Should reject an invalid id without a network call', async () => {
    const httpClient = fakeHttpClient({})
    const getPortById = createGetPortById({ httpClient })

    await expect(getPortById(null)).rejects.toThrow()
    expect(httpClient.get).not.toHaveBeenCalled()
  })

  test('Should raise UPSTREAM_INVALID_RESPONSE for an unexpected status', async () => {
    const httpClient = fakeHttpClient({ status: 500, body: null })
    const getPortById = createGetPortById({ httpClient })

    try {
      await getPortById('port-1')
      throw new Error('expected getPortById to reject')
    } catch (error) {
      expect(error.category).toBe('UPSTREAM_INVALID_RESPONSE')
    }
  })

  test('Should raise RESOURCE_NOT_FOUND for a 404', async () => {
    const httpClient = fakeHttpClient({ status: 404, body: null })
    const getPortById = createGetPortById({ httpClient })

    try {
      await getPortById('port-1')
      throw new Error('expected getPortById to reject')
    } catch (error) {
      expect(error.category).toBe('RESOURCE_NOT_FOUND')
    }
  })

  test.each([
    ['missing root', null],
    ['missing code', validPortBody({ code: undefined })],
    ['missing active', validPortBody({ active: undefined })],
    ['wrong-type active', validPortBody({ active: 'true' })],
    [
      'malformed coordinate',
      validPortBody({ coordinate: { latitude: 'x', longitude: 1 } })
    ],
    ['missing countryCode', validPortBody({ countryCode: undefined })]
  ])('Should reject a malformed response: %s', async (_label, body) => {
    const httpClient = fakeHttpClient({ status: 200, body })
    const getPortById = createGetPortById({ httpClient })

    try {
      await getPortById('port-1')
      throw new Error('expected getPortById to reject')
    } catch (error) {
      expect(error.category).toBe('UPSTREAM_INVALID_RESPONSE')
    }
  })
})
