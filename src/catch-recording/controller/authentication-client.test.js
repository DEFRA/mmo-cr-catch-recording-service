/* global fetchMock */
import { createAuthenticationClient } from './authentication-client.js'
import { isApplicationError } from '#/common/helpers/errors/application-error.js'

const BASE_URL = 'https://authentication-service.example'

function successBody(overrides = {}) {
  return {
    actorId: 'user-1',
    permissions: ['reference-data.read'],
    ...overrides
  }
}

describe('#createAuthenticationClient', () => {
  test('Should return the actor on a successful validation', async () => {
    fetchMock.mockResponseOnce(JSON.stringify(successBody()))
    const client = createAuthenticationClient({
      baseUrl: BASE_URL,
      timeoutMs: 1000
    })

    const actor = await client.validate({
      token: 'SENTINEL-TOKEN',
      correlationId: 'trace-1'
    })

    expect(actor).toEqual({
      actorId: 'user-1',
      permissions: ['reference-data.read']
    })
  })

  test('Should build the request with the Authorization and correlation headers', async () => {
    fetchMock.mockResponseOnce(JSON.stringify(successBody()))
    const client = createAuthenticationClient({
      baseUrl: BASE_URL,
      timeoutMs: 1000,
      tracingHeader: 'x-cdp-request-id'
    })

    await client.validate({ token: 'abc123', correlationId: 'trace-99' })

    expect(fetchMock).toHaveBeenCalledWith(
      `${BASE_URL}/validate`,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer abc123',
          'x-cdp-request-id': 'trace-99'
        })
      })
    )
  })

  test('Should omit the correlation header when no correlation id is supplied', async () => {
    fetchMock.mockResponseOnce(JSON.stringify(successBody()))
    const client = createAuthenticationClient({
      baseUrl: BASE_URL,
      timeoutMs: 1000
    })

    await client.validate({ token: 'abc123' })

    const [, requestInit] = fetchMock.mock.calls[0]
    expect(requestInit.headers['x-cdp-request-id']).toBeUndefined()
  })

  test('Should fail without a network call when no token is supplied', async () => {
    const client = createAuthenticationClient({
      baseUrl: BASE_URL,
      timeoutMs: 1000
    })

    await expect(client.validate({ token: null })).rejects.toSatisfy(
      isApplicationError
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test('Should fail without a network call when the Authentication Service is not configured', async () => {
    const client = createAuthenticationClient({ baseUrl: null })

    await expect(client.validate({ token: 'abc123' })).rejects.toSatisfy(
      isApplicationError
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test.each([401, 403, 400])(
    'Should fail without retrying on a non-retryable %i status',
    async (status) => {
      fetchMock.mockResponseOnce('', { status })
      const client = createAuthenticationClient({
        baseUrl: BASE_URL,
        timeoutMs: 1000,
        retryCount: 2
      })

      await expect(client.validate({ token: 'abc123' })).rejects.toSatisfy(
        isApplicationError
      )
      expect(fetchMock).toHaveBeenCalledTimes(1)
    }
  )

  test.each([502, 503, 504])(
    'Should retry a transient %i status up to the bounded retry count then fail',
    async (status) => {
      fetchMock.mockResponse('', { status })
      const client = createAuthenticationClient({
        baseUrl: BASE_URL,
        timeoutMs: 1000,
        retryCount: 2,
        retryDelayMs: 0
      })

      await expect(client.validate({ token: 'abc123' })).rejects.toSatisfy(
        isApplicationError
      )
      expect(fetchMock).toHaveBeenCalledTimes(3)
    }
  )

  test('Should succeed if a retry eventually returns a successful response', async () => {
    fetchMock
      .mockResponseOnce('', { status: 503 })
      .mockResponseOnce(JSON.stringify(successBody()))
    const client = createAuthenticationClient({
      baseUrl: BASE_URL,
      timeoutMs: 1000,
      retryCount: 2,
      retryDelayMs: 0
    })

    const actor = await client.validate({ token: 'abc123' })

    expect(actor.actorId).toBe('user-1')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  test('Should fail when the request times out', async () => {
    fetchMock.mockResponseOnce(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50))
      return JSON.stringify(successBody())
    })
    const client = createAuthenticationClient({
      baseUrl: BASE_URL,
      timeoutMs: 1,
      retryCount: 0
    })

    await expect(client.validate({ token: 'abc123' })).rejects.toSatisfy(
      isApplicationError
    )
  })

  test('Should fail when the network request itself rejects', async () => {
    fetchMock.mockRejectOnce(new Error('network down'))
    const client = createAuthenticationClient({
      baseUrl: BASE_URL,
      timeoutMs: 1000,
      retryCount: 0
    })

    await expect(client.validate({ token: 'abc123' })).rejects.toSatisfy(
      isApplicationError
    )
  })

  test.each([
    ['missing actorId', { actorId: undefined }],
    ['non-string actorId', { actorId: 42 }],
    ['missing permissions', { permissions: undefined }],
    ['non-array permissions', { permissions: 'reference-data.read' }],
    ['non-string permission entry', { permissions: [42] }]
  ])(
    'Should fail on a malformed success body: %s',
    async (_label, overrides) => {
      fetchMock.mockResponseOnce(JSON.stringify(successBody(overrides)))
      const client = createAuthenticationClient({
        baseUrl: BASE_URL,
        timeoutMs: 1000
      })

      await expect(client.validate({ token: 'abc123' })).rejects.toSatisfy(
        isApplicationError
      )
    }
  )

  test('Should never leak the token or the raw response body in a thrown error', async () => {
    fetchMock.mockResponseOnce(
      JSON.stringify({ leaked: 'SENTINEL-BODY', permissions: [] })
    )
    const client = createAuthenticationClient({
      baseUrl: BASE_URL,
      timeoutMs: 1000
    })

    try {
      await client.validate({ token: 'SENTINEL-TOKEN' })
      throw new Error('expected validate() to reject')
    } catch (error) {
      const serialised = JSON.stringify(error.toJSON())
      expect(serialised).not.toContain('SENTINEL-TOKEN')
      expect(serialised).not.toContain('SENTINEL-BODY')
    }
  })
})
