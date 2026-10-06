/* global fetchMock */
import { createReferenceDataHttpClient } from './reference-data-http-client.js'
import { isApplicationError } from '#/common/helpers/errors/application-error.js'

const BASE_URL = 'https://reference-data-service.example'
const SERVICE_TOKEN = 'service-token-abc'

function client(overrides = {}) {
  return createReferenceDataHttpClient({
    baseUrl: BASE_URL,
    serviceToken: SERVICE_TOKEN,
    timeoutMs: 1000,
    ...overrides
  })
}

describe('#createReferenceDataHttpClient', () => {
  test('Should return status and parsed body for a successful response', async () => {
    fetchMock.mockResponseOnce(JSON.stringify({ id: 'vessel-1' }), {
      status: 200
    })

    const result = await client().get({
      path: '/api/v1/reference-data/vessels/vessel-1'
    })

    expect(result).toEqual({ status: 200, body: { id: 'vessel-1' } })
  })

  test('Should send the configured base URL, path, auth, and correlation headers', async () => {
    fetchMock.mockResponseOnce(JSON.stringify({}), { status: 200 })

    await client({ tracingHeader: 'x-cdp-request-id' }).get({
      path: '/api/v1/reference-data/vessels/vessel-1',
      correlationId: 'trace-1'
    })

    expect(fetchMock).toHaveBeenCalledWith(
      `${BASE_URL}/api/v1/reference-data/vessels/vessel-1`,
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: `Bearer ${SERVICE_TOKEN}`,
          'x-cdp-request-id': 'trace-1'
        })
      })
    )
  })

  test('Should omit the correlation header when no correlation id is supplied', async () => {
    fetchMock.mockResponseOnce(JSON.stringify({}), { status: 200 })

    await client().get({ path: '/api/v1/reference-data/vessels/vessel-1' })

    const [, requestInit] = fetchMock.mock.calls[0]
    expect(requestInit.headers['x-cdp-request-id']).toBeUndefined()
  })

  test('Should return a 404 status for the resource layer to interpret, not throw', async () => {
    fetchMock.mockResponseOnce('', { status: 404 })

    const result = await client().get({
      path: '/api/v1/reference-data/vessels/missing'
    })

    expect(result.status).toBe(404)
  })

  test('Should fail without a network call when baseUrl is not configured', async () => {
    await expect(
      client({ baseUrl: null }).get({ path: '/x' })
    ).rejects.toSatisfy(isApplicationError)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test('Should fail without a network call when serviceToken is not configured', async () => {
    await expect(
      client({ serviceToken: null }).get({ path: '/x' })
    ).rejects.toSatisfy(isApplicationError)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test.each([502, 503, 504])(
    'Should retry a transient %i status up to the bounded retry count then fail',
    async (status) => {
      fetchMock.mockResponse('', { status })

      await expect(
        client({ retryCount: 2, retryDelayMs: 0 }).get({ path: '/x' })
      ).rejects.toSatisfy(isApplicationError)
      expect(fetchMock).toHaveBeenCalledTimes(3)
    }
  )

  test('Should succeed if a retry eventually returns a successful response', async () => {
    fetchMock
      .mockResponseOnce('', { status: 503 })
      .mockResponseOnce(JSON.stringify({ id: 'vessel-1' }), { status: 200 })

    const result = await client({ retryCount: 2, retryDelayMs: 0 }).get({
      path: '/x'
    })

    expect(result.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  test.each([400, 401, 403, 409, 422])(
    'Should not retry a non-transient %i status',
    async (status) => {
      fetchMock.mockResponseOnce('', { status })

      const result = await client({ retryCount: 2 }).get({ path: '/x' })

      expect(result.status).toBe(status)
      expect(fetchMock).toHaveBeenCalledTimes(1)
    }
  )

  test('Should fail distinctly on timeout and not retry it as a transient status', async () => {
    fetchMock.mockResponseOnce(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50))
      return JSON.stringify({})
    })

    await expect(
      client({ timeoutMs: 1, retryCount: 2 }).get({ path: '/x' })
    ).rejects.toSatisfy(isApplicationError)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  test('Should fail without retry when the network request itself rejects', async () => {
    fetchMock.mockRejectOnce(new Error('network down'))

    await expect(
      client({ retryCount: 2 }).get({ path: '/x' })
    ).rejects.toSatisfy(isApplicationError)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  test('Should never leak the service token in a thrown error', async () => {
    fetchMock.mockResponseOnce('', { status: 503 })

    try {
      await client({ retryCount: 0 }).get({ path: '/x' })
      throw new Error('expected get() to reject')
    } catch (error) {
      expect(JSON.stringify(error.toJSON())).not.toContain(SERVICE_TOKEN)
    }
  })

  test('Should tolerate a non-JSON body without throwing from the transport layer', async () => {
    fetchMock.mockResponseOnce('not json', { status: 200 })

    const result = await client().get({ path: '/x' })

    expect(result).toEqual({ status: 200, body: null })
  })
})
