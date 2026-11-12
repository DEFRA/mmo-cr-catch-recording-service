import { vi } from 'vitest'

import { fetchBoundedJson } from './bounded-json-fetch.js'
import { createFetchStub } from './entra-test-fixtures.js'
import { SigningKeyFailure } from './signing-key-failure.js'

const URL_UNDER_TEST = 'https://login.entra.test.invalid/doc'
const options = (routes, overrides = {}) => ({
  url: URL_UNDER_TEST,
  timeoutMs: 1000,
  maxBytes: 1024,
  fetchFn: createFetchStub({ [URL_UNDER_TEST]: routes }),
  unavailableReason: SigningKeyFailure.METADATA_UNAVAILABLE,
  invalidReason: SigningKeyFailure.METADATA_INVALID,
  ...overrides
})

describe('#fetchBoundedJson', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  test('Should return the parsed JSON body and never follow redirects', async () => {
    const opts = options({ json: { hello: 'world' } })

    await expect(fetchBoundedJson(opts)).resolves.toEqual({ hello: 'world' })
    expect(opts.fetchFn.calls[0].options.redirect).toBe('error')
  })

  test.each([[301], [404], [500]])(
    'Should report unavailable for HTTP status %i',
    async (status) => {
      await expect(
        fetchBoundedJson(options({ status, json: {} }))
      ).rejects.toMatchObject({
        reason: SigningKeyFailure.METADATA_UNAVAILABLE
      })
    }
  )

  test('Should report unavailable for a transport failure without leaking the cause', async () => {
    const error = await fetchBoundedJson(
      options({ error: new TypeError('connect ECONNREFUSED secret-host') })
    ).catch((caught) => caught)

    expect(error.reason).toBe(SigningKeyFailure.METADATA_UNAVAILABLE)
    expect(error.message).not.toContain('secret-host')
  })

  test('Should report a timeout when the request exceeds the bounded timeout', async () => {
    vi.useFakeTimers()
    const pending = fetchBoundedJson(options({ hang: true }, { timeoutMs: 50 }))
    const assertion = expect(pending).rejects.toMatchObject({
      reason: SigningKeyFailure.REQUEST_TIMEOUT
    })

    await vi.advanceTimersByTimeAsync(51)
    await assertion
  })

  test('Should report invalid content for unparsable JSON', async () => {
    await expect(
      fetchBoundedJson(options({ text: '<html>not json</html>' }))
    ).rejects.toMatchObject({ reason: SigningKeyFailure.METADATA_INVALID })
  })

  test('Should reject a body larger than the limit as invalid content', async () => {
    await expect(
      fetchBoundedJson(
        options({ text: JSON.stringify({ a: 'x'.repeat(2000) }) })
      )
    ).rejects.toMatchObject({ reason: SigningKeyFailure.METADATA_INVALID })
  })

  test('Should reject a declared content-length larger than the limit before reading', async () => {
    await expect(
      fetchBoundedJson(
        options({ json: {}, headers: { 'content-length': '999999' } })
      )
    ).rejects.toMatchObject({ reason: SigningKeyFailure.METADATA_INVALID })
  })

  test('Should bound a response whose body cannot be streamed', async () => {
    const fetchFn = async () => ({
      status: 200,
      headers: new Headers(),
      text: async () => 'x'.repeat(2000)
    })

    await expect(
      fetchBoundedJson(options({}, { fetchFn }))
    ).rejects.toMatchObject({ reason: SigningKeyFailure.METADATA_INVALID })
  })

  test('Should parse a response whose body cannot be streamed', async () => {
    const fetchFn = async () => ({
      status: 200,
      headers: new Headers(),
      text: async () => '{"ok":true}'
    })

    await expect(fetchBoundedJson(options({}, { fetchFn }))).resolves.toEqual({
      ok: true
    })
  })
})
