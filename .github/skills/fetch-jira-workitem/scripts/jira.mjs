import { guardedFetch } from './http.mjs'
import { SafeError } from './redactor.mjs'
import { safeKey, REQUEST_FIELDS } from './sanitise.mjs'

const KEY_RE = /^[A-Z][A-Z0-9]+-\d+$/
const MAX_SEARCH_PAGES = 20

// Extracts a validated Jira key from a ticket URL or a bare key. Rejects
// anything malformed so input can never build an unsafe request path. When
// `expectedHost` is given and the input is a URL, the URL must point at the
// configured Jira site (its own links inside the ticket are never fetched).
export function parseTicketRef(input, { expectedHost } = {}) {
  if (typeof input !== 'string' || input.trim() === '') {
    throw new SafeError('No Jira ticket URL or key provided.', {
      code: 'ERR_INPUT'
    })
  }
  const raw = input.trim()
  const asKey = raw.toUpperCase()
  if (KEY_RE.test(asKey)) return asKey
  let url
  try {
    url = new URL(raw)
  } catch {
    throw new SafeError('Input is neither a valid Jira key nor a URL.', {
      code: 'ERR_INPUT'
    })
  }
  if (
    expectedHost &&
    url.host.toLowerCase() !== String(expectedHost).toLowerCase()
  ) {
    throw new SafeError(
      'The ticket URL does not match the configured Jira site (JIRA_BASE_URL).',
      { code: 'ERR_INPUT' }
    )
  }
  const selected = url.searchParams.get('selectedIssue')
  if (selected && KEY_RE.test(selected.toUpperCase()))
    {return selected.toUpperCase()}
  const browse = url.pathname.match(/\/browse\/([A-Za-z][A-Za-z0-9]+-\d+)/)
  if (browse) return browse[1].toUpperCase()
  const segment = url.pathname
    .split('/')
    .reverse()
    .find((s) => KEY_RE.test(s.toUpperCase()))
  if (segment) return segment.toUpperCase()
  throw new SafeError('Could not find a Jira issue key in the URL.', {
    code: 'ERR_INPUT'
  })
}

function authError(status) {
  if (status === 401 || status === 403) {
    throw new SafeError(
      'Jira denied access. If credentials appear wrong, ask the user to check the .env file.',
      { code: 'ERR_AUTH' }
    )
  }
}

function rateLimitError(status) {
  if (status === 429) {
    throw new SafeError(
      'Jira rate limit reached (429) — stopping early without retrying. Wait a while before re-running.',
      { code: 'ERR_RATE_LIMIT' }
    )
  }
}

// Read-only Jira Cloud client (Basic auth). Requests only the allowlisted fields.
export function createJiraClient(config) {
  const basic = Buffer.from(`${config.email}:${config.apiToken}`).toString(
    'base64'
  )
  const headers = {
    Authorization: `Basic ${basic}`,
    Accept: 'application/json'
  }
  const fields = REQUEST_FIELDS.join(',')

  async function getIssue(key) {
    const validKey = safeKey(key)
    if (!validKey)
      {throw new SafeError('Refusing to fetch an invalid issue key.', {
        code: 'ERR_INPUT'
      })}
    const url = `${config.baseUrl}/rest/api/3/issue/${encodeURIComponent(validKey)}?fields=${encodeURIComponent(fields)}&fieldsByKeys=false`
    const res = await guardedFetch(
      url,
      { headers },
      { allowedHosts: config.egressHosts }
    )
    if (res.status === 404) return null
    authError(res.status)
    rateLimitError(res.status)
    if (!res.ok)
      {throw new SafeError(`Jira request failed (${res.status}).`, {
        code: 'ERR_JIRA'
      })}
    return res.json()
  }

  // Discovers Epic->Story style children (parent = key) not in the subtasks field.
  async function searchChildren(key) {
    const validKey = safeKey(key)
    if (!validKey) return []
    const url = `${config.baseUrl}/rest/api/3/search/jql`
    const jql = `parent = "${validKey}" ORDER BY key ASC`
    const issues = []
    let nextPageToken
    for (let page = 0; page < MAX_SEARCH_PAGES; page += 1) {
      const body = { jql, fields: REQUEST_FIELDS, maxResults: 100 }
      if (nextPageToken) body.nextPageToken = nextPageToken
      const res = await guardedFetch(
        url,
        {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        },
        { allowedHosts: config.egressHosts }
      )
      authError(res.status)
      rateLimitError(res.status)
      if (res.status === 400 || res.status === 404) return issues
      if (!res.ok)
        {throw new SafeError(`Jira child search failed (${res.status}).`, {
          code: 'ERR_JIRA'
        })}
      const data = await res.json()
      if (Array.isArray(data.issues)) issues.push(...data.issues)
      nextPageToken = data.nextPageToken
      if (!nextPageToken) break
    }
    return issues
  }

  return { getIssue, searchChildren }
}
