import {
  readBoundedText,
  ResponseBodyTooLargeError
} from '#/common/helpers/http/read-bounded-text.js'
import { SigningKeyError, SigningKeyFailure } from './signing-key-failure.js'

const HTTP_STATUS_OK_MIN = 200
const HTTP_STATUS_OK_MAX = 299

/**
 * Retrieves and parses one JSON document with a bounded timeout and bounded body size. Redirects are
 * never followed so the configured trust boundary cannot be silently moved. Every failure is mapped to
 * a {@link SigningKeyError}; transport and parser errors, URLs and bodies are never propagated.
 *
 * @param {Object} options
 * @param {string} options.url
 * @param {number} options.timeoutMs
 * @param {number} options.maxBytes
 * @param {typeof fetch} options.fetchFn
 * @param {string} options.unavailableReason failure reason for transport/HTTP failures
 * @param {string} options.invalidReason failure reason for unparsable or oversized content
 * @returns {Promise<unknown>}
 */
export async function fetchBoundedJson({
  url,
  timeoutMs,
  maxBytes,
  fetchFn,
  unavailableReason,
  invalidReason
}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetchFn(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      redirect: 'error',
      signal: controller.signal
    })

    if (
      response.status < HTTP_STATUS_OK_MIN ||
      response.status > HTTP_STATUS_OK_MAX
    ) {
      throw new SigningKeyError(unavailableReason)
    }

    return JSON.parse(await readBoundedText(response, maxBytes))
  } catch (cause) {
    throw toSigningKeyError(cause, {
      controller,
      unavailableReason,
      invalidReason
    })
  } finally {
    clearTimeout(timer)
  }
}

function toSigningKeyError(
  cause,
  { controller, unavailableReason, invalidReason }
) {
  if (cause instanceof SigningKeyError) {
    return cause
  }
  if (cause instanceof ResponseBodyTooLargeError) {
    return new SigningKeyError(invalidReason)
  }
  if (controller.signal.aborted) {
    return new SigningKeyError(SigningKeyFailure.REQUEST_TIMEOUT)
  }
  if (cause instanceof SyntaxError) {
    return new SigningKeyError(invalidReason)
  }
  return new SigningKeyError(unavailableReason)
}
