import { isApplicationError } from '#/common/helpers/errors/application-error.js'
import { authenticationRequiredError } from './authentication-errors.js'

const DEFAULT_PATH = '/validate'
const BEARER_PREFIX = 'Bearer '
const HTTP_STATUS_BAD_GATEWAY = 502
const HTTP_STATUS_SERVICE_UNAVAILABLE = 503
const HTTP_STATUS_GATEWAY_TIMEOUT = 504
const RETRYABLE_STATUSES = new Set([
  HTTP_STATUS_BAD_GATEWAY,
  HTTP_STATUS_SERVICE_UNAVAILABLE,
  HTTP_STATUS_GATEWAY_TIMEOUT
])

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Validates the exact approved success shape (`{ actorId: string, permissions: string[] }`); anything
 * else is treated as a malformed response and fails closed rather than being partially trusted.
 *
 * @param {unknown} body
 * @returns {{ actorId: string, permissions: string[] } | null}
 */
function parseSuccessBody(body) {
  if (
    !body ||
    typeof body.actorId !== 'string' ||
    !Array.isArray(body.permissions) ||
    !body.permissions.every((permission) => typeof permission === 'string')
  ) {
    return null
  }

  return { actorId: body.actorId, permissions: body.permissions }
}

async function sendValidateRequest(options, { token, correlationId }) {
  const { baseUrl, path, timeoutMs, tracingHeader, fetchFn } = options
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    return await fetchFn(`${baseUrl}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `${BEARER_PREFIX}${token}`,
        ...(correlationId ? { [tracingHeader]: correlationId } : {})
      },
      signal: controller.signal
    })
  } finally {
    clearTimeout(timer)
  }
}

async function attemptValidate(options, { token, correlationId }) {
  const response = await sendValidateRequest(options, { token, correlationId })

  if (!response.ok) {
    const error = new Error(
      `Authentication Service responded with status ${response.status}`
    )
    error.retryableStatus = RETRYABLE_STATUSES.has(response.status)
    throw error
  }

  const actor = parseSuccessBody(await response.json())
  if (!actor) {
    throw authenticationRequiredError(
      new Error('Authentication Service returned a malformed response')
    )
  }

  return actor
}

async function validateWithRetry(
  options,
  { token, correlationId },
  attempt = 0
) {
  const { retryCount, retryDelayMs } = options

  try {
    return await attemptValidate(options, { token, correlationId })
  } catch (cause) {
    // A malformed response is already a safe ApplicationError raised above - never retry it, and
    // never swallow it into the generic retry-exhaustion path.
    if (isApplicationError(cause)) {
      throw cause
    }

    const isLastAttempt = attempt === retryCount
    if (isLastAttempt || cause.retryableStatus === false) {
      throw authenticationRequiredError(cause)
    }

    await sleep(retryDelayMs)
    // Recursion (not a loop) for the next attempt: every exit from this function is an explicit
    // `return`/`throw`, and `retryCount` bounds the recursion depth to a small, fixed number.
    return validateWithRetry(options, { token, correlationId }, attempt + 1)
  }
}

function guardValidateInput(options, { token }) {
  if (!token) {
    return authenticationRequiredError(new Error('No bearer token supplied'))
  }
  if (!options.baseUrl) {
    return authenticationRequiredError(
      new Error('Authentication Service is not configured')
    )
  }
  return null
}

/**
 * Framework-neutral bounded HTTP adapter for the Authentication Service. The only module in this
 * directory that performs network I/O. Never imports Hapi, Boom, or MongoDB.
 *
 * @param {Object} [options]
 * @param {string|null} [options.baseUrl] Authentication Service base URL (`authentication.baseUrl`)
 * @param {string} [options.path] defaults to `/validate`
 * @param {number} [options.timeoutMs]
 * @param {number} [options.retryCount] bounded retries, applied only to 502/503/504
 * @param {number} [options.retryDelayMs]
 * @param {string} [options.tracingHeader] correlation header name (`tracing.header`)
 * @param {typeof fetch} [options.fetchFn]
 * @returns {{ validate: (input: { token: string, correlationId?: string }) => Promise<{ actorId:
 *   string, permissions: string[] }> }}
 */
export function createAuthenticationClient({
  baseUrl = null,
  path = DEFAULT_PATH,
  timeoutMs,
  retryCount = 0,
  retryDelayMs = 0,
  tracingHeader = 'x-cdp-request-id',
  fetchFn = fetch
} = {}) {
  const options = {
    baseUrl,
    path,
    timeoutMs,
    retryCount,
    retryDelayMs,
    tracingHeader,
    fetchFn
  }

  async function validate({ token, correlationId } = {}) {
    const guardFailure = guardValidateInput(options, { token })
    if (guardFailure) {
      throw guardFailure
    }

    return validateWithRetry(options, { token, correlationId })
  }

  return { validate }
}
