import { guardedFetch } from './http.mjs'
import { SafeError } from './redactor.mjs'

const ID_RE = /^\d+$/
const MAX_ATTACHMENT_PAGES = 20

// Extracts a validated numeric page id from a Confluence page URL or a bare id.
// Rejects anything malformed so input can never build an unsafe request path.
// When `expectedHost` is given and the input is a URL, the URL must point at the
// configured Confluence site. Short "/wiki/x/<token>" tiny links are not
// supported (they would require following a redirect) — pass the full page URL
// or the numeric page id instead.
export function parsePageRef (input, { expectedHost } = {}) {
  if (typeof input !== 'string' || input.trim() === '') {
    throw new SafeError('No Confluence page URL or id provided.', { code: 'ERR_INPUT' })
  }
  const raw = input.trim()
  if (ID_RE.test(raw)) return raw
  let url
  try {
    url = new URL(raw)
  } catch {
    throw new SafeError('Input is neither a valid Confluence page id nor a URL.', { code: 'ERR_INPUT' })
  }
  if (expectedHost && url.host.toLowerCase() !== String(expectedHost).toLowerCase()) {
    throw new SafeError('The page URL does not match the configured Confluence site (CONFLUENCE_BASE_URL).', { code: 'ERR_INPUT' })
  }
  const pageIdParam = url.searchParams.get('pageId')
  if (pageIdParam && ID_RE.test(pageIdParam)) return pageIdParam
  const inPath = url.pathname.match(/\/pages\/(\d+)/)
  if (inPath) return inPath[1]
  throw new SafeError(
    'Could not find a numeric Confluence page id in the URL. Provide the full page URL (…/pages/<id>/…) or the numeric page id. Short "/wiki/x/…" links are not supported.',
    { code: 'ERR_INPUT' }
  )
}

function safePageId (id) {
  return typeof id === 'string' && ID_RE.test(id) ? id : null
}

function authError (status) {
  if (status === 401 || status === 403) {
    throw new SafeError('Confluence denied access. If credentials appear wrong, ask the user to check the .env file.', { code: 'ERR_AUTH' })
  }
}

function rateLimitError (status) {
  if (status === 429) {
    throw new SafeError('Confluence rate limit reached (429) — stopping early without retrying. Wait a while before re-running.', { code: 'ERR_RATE_LIMIT' })
  }
}

// Reads the opaque pagination cursor out of a v2 `_links.next` relative URL.
function nextCursor (data) {
  const next = data?._links?.next
  if (typeof next !== 'string' || !next.includes('?')) return null
  const cursor = new URLSearchParams(next.slice(next.indexOf('?') + 1)).get('cursor')
  return cursor || null
}

// Read-only Confluence Cloud client (Basic auth). GET-only, by design — this
// module exposes no create/update/delete/comment/attach method and must never
// gain one. Requests only the page body in ADF (atlas_doc_format) plus labels;
// attachment descriptors are fetched separately. No identity-bearing include-*
// flags are ever requested.
export function createConfluenceClient (config) {
  const basic = Buffer.from(`${config.email}:${config.apiToken}`).toString('base64')
  const headers = { Authorization: `Basic ${basic}`, Accept: 'application/json' }

  // Defence in depth: guardedFetch is only ever invoked with GET (the default,
  // never overridden) below — this assertion fails loudly if that ever changes.
  function assertGet (options) {
    if (options?.method && options.method.toUpperCase() !== 'GET') {
      throw new SafeError('Refusing a non-GET request: this skill is strictly read-only.', { code: 'ERR_READONLY' })
    }
  }

  async function getPage (id) {
    const validId = safePageId(id)
    if (!validId) throw new SafeError('Refusing to fetch an invalid page id.', { code: 'ERR_INPUT' })
    const url = `${config.apiBase}/pages/${encodeURIComponent(validId)}?body-format=atlas_doc_format&include-labels=true`
    const options = { headers }
    assertGet(options)
    const res = await guardedFetch(url, options, { allowedHosts: config.egressHosts })
    if (res.status === 404) return null
    authError(res.status)
    rateLimitError(res.status)
    if (!res.ok) throw new SafeError(`Confluence request failed (${res.status}).`, { code: 'ERR_CONFLUENCE' })
    return res.json()
  }

  async function getAttachments (id) {
    const validId = safePageId(id)
    if (!validId) return { attachments: [], truncated: false }
    const attachments = []
    let cursor
    let truncated = false
    for (let page = 0; page < MAX_ATTACHMENT_PAGES; page += 1) {
      const params = new URLSearchParams({ limit: '250' })
      if (cursor) params.set('cursor', cursor)
      const url = `${config.apiBase}/pages/${encodeURIComponent(validId)}/attachments?${params.toString()}`
      const options = { headers }
      assertGet(options)
      const res = await guardedFetch(url, options, { allowedHosts: config.egressHosts })
      if (res.status === 400 || res.status === 404) break
      authError(res.status)
      rateLimitError(res.status)
      if (!res.ok) throw new SafeError(`Confluence attachment request failed (${res.status}).`, { code: 'ERR_CONFLUENCE' })
      const data = await res.json()
      if (Array.isArray(data.results)) attachments.push(...data.results)
      if (attachments.length >= config.maxAttachments) { truncated = true; break }
      cursor = nextCursor(data)
      if (!cursor) break
    }
    return { attachments: attachments.slice(0, config.maxAttachments), truncated }
  }

  return { getPage, getAttachments }
}
