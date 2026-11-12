import { safeLog } from '#/common/helpers/logging/safe-log.js'
import { isAuthenticatedUserContext } from '#/authentication/entra/authenticated-user-context.js'
import {
  readBoundedText,
  ResponseBodyTooLargeError
} from '#/common/helpers/http/read-bounded-text.js'

const USER_ID_PLACEHOLDER = '{entraObjectId}'
const MAX_RESPONSE_BYTES = 256 * 1024
const JSON_MEDIA_TYPE = 'application/json'
const CORRELATION_ID_FORMAT = /^[A-Za-z0-9._-]{1,128}$/
const HTTP_STATUS_OK = 200
const HTTP_STATUS_NOT_FOUND = 404
const HTTP_STATUS_TOO_MANY_REQUESTS = 429
const HTTP_STATUS_CLIENT_ERROR_MIN = 400
const HTTP_STATUS_SERVER_ERROR_MIN = 500
// Approved transient statuses: the only ones that are reported as UNAVAILABLE and retried
const TRANSIENT_STATUSES = new Set([502, 503, 504])

/**
 * Typed outcomes of a User Profile Service request. They describe what happened at the transport level
 * only: none is an authorisation decision and none maps to a public HTTP status here.
 */
export const UserProfileOutcome = Object.freeze({
  NOT_FOUND: 'NOT_FOUND',
  CLIENT_ERROR: 'CLIENT_ERROR',
  RATE_LIMITED: 'RATE_LIMITED',
  SERVER_ERROR: 'SERVER_ERROR',
  UNAVAILABLE: 'UNAVAILABLE',
  UNEXPECTED_STATUS: 'UNEXPECTED_STATUS',
  UNEXPECTED_CONTENT_TYPE: 'UNEXPECTED_CONTENT_TYPE',
  INVALID_JSON: 'INVALID_JSON',
  TIMEOUT: 'TIMEOUT',
  CANCELLED: 'CANCELLED',
  TRANSPORT_FAILURE: 'TRANSPORT_FAILURE',
  INTERNAL_ERROR: 'INTERNAL_ERROR'
})

const OPERATION = Object.freeze({
  USER_ROLES: 'user-roles',
  ROLE_DEFINITIONS: 'role-definitions'
})

const failure = (outcome, status = null) =>
  Object.freeze({ ok: false, outcome, status })

function deepFreeze(value) {
  if (value !== null && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze)
    Object.freeze(value)
  }
  return value
}

function statusFailure(status) {
  if (status === HTTP_STATUS_NOT_FOUND) {
    return failure(UserProfileOutcome.NOT_FOUND, status)
  }
  if (status === HTTP_STATUS_TOO_MANY_REQUESTS) {
    return failure(UserProfileOutcome.RATE_LIMITED, status)
  }
  if (TRANSIENT_STATUSES.has(status)) {
    return failure(UserProfileOutcome.UNAVAILABLE, status)
  }
  if (status >= HTTP_STATUS_SERVER_ERROR_MIN) {
    return failure(UserProfileOutcome.SERVER_ERROR, status)
  }
  if (status >= HTTP_STATUS_CLIENT_ERROR_MIN) {
    return failure(UserProfileOutcome.CLIENT_ERROR, status)
  }
  return failure(UserProfileOutcome.UNEXPECTED_STATUS, status)
}

function sleep(ms, signal) {
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms)
    function done() {
      clearTimeout(timer)
      signal?.removeEventListener('abort', done)
      resolve()
    }
    signal?.addEventListener('abort', done, { once: true })
  })
}

/**
 * Framework-neutral transport client for the two approved User Profile Service reads:
 * `GET /users/{entraObjectId}/roles` and `GET /roles-definitions/services/{serviceId}`.
 *
 * - URLs come only from validated configuration; the user identifier comes only from the trusted
 *   authenticated-user context and is encoded as one path segment.
 * - No credential of any kind is sent: the incoming access token is never forwarded and no downstream
 *   authentication exists (the current User Profile Service is an unauthenticated mock; production
 *   service-to-service security is a deferred production concern).
 * - Bounded timeout per attempt, bounded retry of 502/503/504 only (the repository's approved policy),
 *   cancellable by the caller, redirects never followed, response size bounded.
 * - It performs no caching and no semantic validation: a result body is an untrusted, frozen transport
 *   object that Step 06 must validate before use.
 *
 * @param {Object} options
 * @param {string} options.userRolesUrlTemplate `authorization.userRolesUrlTemplate`
 * @param {string} options.roleDefinitionsUrl `authorization.roleDefinitionsUrl`
 * @param {number} options.userProfileRequestTimeoutMs
 * @param {number} [options.userProfileRetryCount]
 * @param {number} [options.userProfileRetryDelayMs]
 * @param {string} [options.tracingHeader] correlation header name (`tracing.header`)
 * @param {typeof fetch} [options.fetchFn]
 * @param {{ debug: Function, warn: Function }} [options.logger]
 * @param {(ms: number, signal?: AbortSignal) => Promise<void>} [options.sleepFn]
 */
export function createUserProfileClient({
  userRolesUrlTemplate,
  roleDefinitionsUrl,
  userProfileRequestTimeoutMs,
  userProfileRetryCount = 0,
  userProfileRetryDelayMs = 0,
  tracingHeader = 'x-cdp-request-id',
  fetchFn = fetch,
  logger,
  sleepFn = sleep
}) {
  async function attempt({ url, correlationId, signal }) {
    const controller = new AbortController()
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, userProfileRequestTimeoutMs)
    const abortFromCaller = () => controller.abort()
    signal?.addEventListener('abort', abortFromCaller, { once: true })

    try {
      const response = await fetchFn(url, {
        method: 'GET',
        headers: {
          Accept: JSON_MEDIA_TYPE,
          ...(typeof correlationId === 'string' &&
          CORRELATION_ID_FORMAT.test(correlationId)
            ? { [tracingHeader]: correlationId }
            : {})
        },
        redirect: 'error',
        signal: controller.signal
      })

      if (response.status !== HTTP_STATUS_OK) {
        return statusFailure(response.status)
      }
      if (
        !response.headers
          ?.get('content-type')
          ?.toLowerCase()
          .startsWith(JSON_MEDIA_TYPE)
      ) {
        return failure(UserProfileOutcome.UNEXPECTED_CONTENT_TYPE)
      }

      const body = JSON.parse(
        await readBoundedText(response, MAX_RESPONSE_BYTES)
      )
      return Object.freeze({ ok: true, body: deepFreeze(body) })
    } catch (cause) {
      if (signal?.aborted) {
        return failure(UserProfileOutcome.CANCELLED)
      }
      if (timedOut) {
        return failure(UserProfileOutcome.TIMEOUT)
      }
      if (
        cause instanceof SyntaxError ||
        cause instanceof ResponseBodyTooLargeError
      ) {
        return failure(UserProfileOutcome.INVALID_JSON)
      }
      return failure(UserProfileOutcome.TRANSPORT_FAILURE)
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abortFromCaller)
    }
  }

  async function request(operation, { url, correlationId, signal }) {
    if (signal?.aborted) {
      return failure(UserProfileOutcome.CANCELLED)
    }

    const startedAt = Date.now()
    let result = null

    for (
      let attemptNumber = 0;
      attemptNumber <= userProfileRetryCount;
      attemptNumber++
    ) {
      result = await attempt({ url, correlationId, signal })

      const retryable =
        !result.ok &&
        result.outcome === UserProfileOutcome.UNAVAILABLE &&
        attemptNumber < userProfileRetryCount
      if (!retryable) {
        break
      }

      safeLog(
        logger,
        'warn',
        {
          event: 'user-profile.retry',
          operation,
          outcome: result.outcome,
          status: result.status,
          attempt: attemptNumber + 1
        },
        'user-profile.retry'
      )
      await sleepFn(userProfileRetryDelayMs, signal)
      if (signal?.aborted) {
        result = failure(UserProfileOutcome.CANCELLED)
        break
      }
    }

    const logEntry = {
      event: 'user-profile.request',
      operation,
      correlationId,
      outcome: result.ok ? 'SUCCESS' : result.outcome,
      status: result.ok ? HTTP_STATUS_OK : result.status,
      durationMs: Date.now() - startedAt
    }
    if (result.ok) {
      safeLog(logger, 'debug', logEntry, 'user-profile.request')
    } else {
      safeLog(logger, 'warn', logEntry, 'user-profile.request')
    }

    return result
  }

  /**
   * @param {Readonly<{ userId: string }>} user the trusted authenticated-user context (Step 04)
   * @param {{ correlationId?: string, signal?: AbortSignal }} [options]
   */
  async function getUserRoles(user, { correlationId, signal } = {}) {
    if (!isAuthenticatedUserContext(user)) {
      return failure(UserProfileOutcome.INTERNAL_ERROR)
    }

    return request(OPERATION.USER_ROLES, {
      url: userRolesUrlTemplate.replace(
        USER_ID_PLACEHOLDER,
        encodeURIComponent(user.userId)
      ),
      correlationId,
      signal
    })
  }

  /**
   * @param {{ correlationId?: string, signal?: AbortSignal }} [options]
   */
  async function getRoleDefinitions({ correlationId, signal } = {}) {
    return request(OPERATION.ROLE_DEFINITIONS, {
      url: roleDefinitionsUrl,
      correlationId,
      signal
    })
  }

  return { getUserRoles, getRoleDefinitions }
}
