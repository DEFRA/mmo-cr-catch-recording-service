import {
  dependencyUnavailableError,
  upstreamTimeoutError
} from './reference-data-errors.js'

const RETRYABLE_STATUSES = new Set([502, 503, 504])

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function parseBody(response) {
  try {
    return await response.json()
  } catch {
    return null
  }
}

async function sendRequest(options, { path, correlationId }) {
  const { baseUrl, serviceToken, timeoutMs, tracingHeader, fetchFn } = options
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    return await fetchFn(`${baseUrl}${path}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${serviceToken}`,
        Accept: 'application/json',
        ...(correlationId ? { [tracingHeader]: correlationId } : {})
      },
      signal: controller.signal
    })
  } finally {
    clearTimeout(timer)
  }
}

async function attemptGet(options, { path, correlationId }) {
  const response = await sendRequest(options, { path, correlationId })

  if (RETRYABLE_STATUSES.has(response.status)) {
    const error = new Error(
      `Reference Data Service responded with status ${response.status}`
    )
    error.retryableStatus = true
    throw error
  }

  const body = await parseBody(response)
  return { status: response.status, body }
}

async function getWithRetry(options, { path, correlationId }) {
  const { retryCount, retryDelayMs } = options

  for (let attempt = 0; attempt <= retryCount; attempt += 1) {
    try {
      return await attemptGet(options, { path, correlationId })
    } catch (cause) {
      // Only the explicitly approved 502/503/504 transient statuses are ever retried. A timeout (this
      // attempt's own AbortController firing) and any other network-level failure (DNS, connection
      // refused, etc.) are reported immediately and distinctly - retry behaviour beyond the approved
      // scope is never invented.
      if (cause?.name === 'AbortError') {
        throw upstreamTimeoutError(cause)
      }
      if (cause?.retryableStatus !== true) {
        throw dependencyUnavailableError(cause)
      }

      const isLastAttempt = attempt === retryCount
      if (isLastAttempt) {
        throw dependencyUnavailableError(cause)
      }
      await sleep(retryDelayMs)
    }
  }
}

function guardGetInput(options) {
  if (!options.baseUrl) {
    return dependencyUnavailableError(
      new Error('Reference Data Service is not configured')
    )
  }
  if (!options.serviceToken) {
    return dependencyUnavailableError(
      new Error('Reference Data Service credential is not configured')
    )
  }
  return null
}

/**
 * Framework-neutral internal bounded HTTP adapter for the Reference Data Service. Not part of the
 * public client contract exported by `reference-data-client.js` - each resource module calls `get`
 * internally and interprets the resulting `{ status, body }` itself (404 vs other status, response
 * shape). Never imports Hapi, Boom, or MongoDB.
 *
 * A timeout (the current request's own `AbortController` firing) surfaces as a plain `AbortError` from
 * `fetchFn`, which - like any other network-level rejection - is treated as a non-retryable-in-place
 * failure here and mapped to `upstreamTimeoutError`, distinct from a transient 502/503/504 response
 * (which `getWithRetry` bounded-retries before giving up with `dependencyUnavailableError`).
 *
 * @param {Object} [options]
 * @param {string|null} [options.baseUrl]
 * @param {string|null} [options.serviceToken]
 * @param {number} [options.timeoutMs]
 * @param {number} [options.retryCount]
 * @param {number} [options.retryDelayMs]
 * @param {string} [options.tracingHeader]
 * @param {typeof fetch} [options.fetchFn]
 * @returns {{ get: (input: { path: string, correlationId?: string }) => Promise<{ status: number, body:
 *   unknown }> }}
 */
export function createReferenceDataHttpClient({
  baseUrl = null,
  serviceToken = null,
  timeoutMs,
  retryCount = 0,
  retryDelayMs = 0,
  tracingHeader = 'x-cdp-request-id',
  fetchFn = fetch
} = {}) {
  const options = {
    baseUrl,
    serviceToken,
    timeoutMs,
    retryCount,
    retryDelayMs,
    tracingHeader,
    fetchFn
  }

  async function get({ path, correlationId } = {}) {
    const guardFailure = guardGetInput(options)
    if (guardFailure) {
      throw guardFailure
    }

    return getWithRetry(options, { path, correlationId })
  }

  return { get }
}
