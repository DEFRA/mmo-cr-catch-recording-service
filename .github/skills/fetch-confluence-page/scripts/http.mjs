import { SafeError, redactString } from './redactor.mjs'

// Enforces the network egress boundary: only the hosts in `allowedHosts` (the
// Confluence site) may be contacted. Blocks SSRF and guarantees URLs found in
// page text are never fetched.
export function assertAllowedHost (rawUrl, allowedHosts) {
  if (!Array.isArray(allowedHosts) || allowedHosts.length === 0) {
    throw new SafeError('Refusing request: no egress allowlist configured.', { code: 'ERR_EGRESS' })
  }
  let url
  try {
    url = new URL(rawUrl)
  } catch {
    throw new SafeError('Refusing to request an invalid URL.', { code: 'ERR_EGRESS' })
  }
  if (url.protocol !== 'https:') throw new SafeError('Refusing non-https request.', { code: 'ERR_EGRESS' })
  const allowed = allowedHosts.some((h) => url.host === h || url.host.endsWith(`.${h}`))
  if (!allowed) throw new SafeError(`Refusing to contact disallowed host "${url.host}".`, { code: 'ERR_EGRESS' })
  return url
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function backoffDelay (attempt, retryAfterHeader) {
  const retryAfter = Number.parseInt(retryAfterHeader, 10)
  if (Number.isInteger(retryAfter) && retryAfter > 0) return retryAfter * 1000
  const base = Math.min(2000 * 2 ** attempt, 30000)
  return Math.round(base * (0.7 + Math.random() * 0.6))
}

// fetch wrapper that enforces the egress allowlist and retries 5xx with
// exponential backoff + jitter. A 429 (rate limit) is NOT retried: it is returned
// immediately so the caller can fail fast and stop early rather than waiting on
// backoff. Never logs the Authorization header.
export async function guardedFetch (rawUrl, options = {}, { allowedHosts, maxRetries = 4 } = {}) {
  assertAllowedHost(rawUrl, allowedHosts)
  for (let attempt = 0; ; attempt += 1) {
    let res
    try {
      res = await fetch(rawUrl, options)
    } catch (err) {
      throw new SafeError(`Network request failed: ${redactString(String(err?.message ?? err))}`, { code: 'ERR_NETWORK' })
    }
    // Fail fast on rate limiting (429) and any non-5xx status; only retry 5xx.
    if (res.status < 500) return res
    if (attempt >= maxRetries) return res
    await sleep(backoffDelay(attempt, res.headers.get('retry-after')))
  }
}
