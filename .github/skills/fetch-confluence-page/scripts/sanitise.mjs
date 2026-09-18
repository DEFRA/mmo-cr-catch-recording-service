import { createHash } from 'node:crypto'
import { SafeError } from './redactor.mjs'

// The sanitisation boundary. Deterministic, non-AI. Every raw Confluence page
// passes through sanitisePage() and comes out as an allowlisted, PII-free record
// that fails closed (unknown shape or surviving identity data => throw).

export const SCHEMA_VERSION = '1.0.0'
export const SANITISER_VERSION = '1.0.0'

const ID_RE = /^\d+$/
const DESIGN_EXTENSIONS = new Set(['fig', 'sketch', 'xd'])
const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/
const EMAIL_RE_G = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g
const ACCOUNT_ID_RE = /accountId=/i
// International (+44 7...), UK trunk with spaced groups (0800 917 9651,
// 07584 335414) and UK trunk with no separators (07786126445). Deliberately
// requires a leading '+' or '0' so it never matches unrelated digit runs
// (build/version/ticket numbers) elsewhere in the body.
const PHONE_RE_G = /\+[ ]?\d{1,4}[ ]?\d{6,12}\b|\b0\d{9,10}\b|\b0\d{1,4}(?:[ ]\d{2,6}){1,3}\b/g
// Table column headers whose cell content should be treated as a person's name.
const NAME_COLUMN_RE = /\bnames?\b/i

// --- URL policy -----------------------------------------------------------

// Drops query and fragment (removes tracking params and embedded identifiers).
function sanitiseUrl (raw) {
  if (typeof raw !== 'string' || raw.trim() === '') return null
  let url
  try {
    url = new URL(raw.trim())
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, '')}`
}

// --- ADF reduction --------------------------------------------------------

// Reduces an ADF node tree to safe plain text. `mention` nodes become
// "@[redacted]"; link/card URLs are kept inline in the text (query/fragment
// stripped); unknown nodes contribute nested text only. Table cells under a
// "Name"-headed column have their plain text redacted (see renderTable).
function reduceAdf (doc) {
  const state = { warnings: [], redactPlainTextAsName: false }
  if (!doc || typeof doc !== 'object' || doc.type !== 'doc' || !Array.isArray(doc.content)) {
    if (doc != null) state.warnings.push('body was not valid ADF; omitted')
    return { text: '', warnings: state.warnings }
  }
  return { text: renderNodes(doc.content, state).trim(), warnings: state.warnings }
}

function renderNodes (nodes, state) {
  return Array.isArray(nodes) ? nodes.map((n) => renderNode(n, state)).join('') : ''
}

// Returns the sanitised href of a text node's link mark, if any.
function linkHref (node) {
  if (!Array.isArray(node.marks)) return null
  for (const mark of node.marks) {
    if (mark?.type === 'link' && typeof mark.attrs?.href === 'string') {
      return sanitiseUrl(mark.attrs.href)
    }
  }
  return null
}

function clampLevel (level) {
  const n = Number.parseInt(level, 10)
  return Number.isInteger(n) ? Math.min(6, Math.max(1, n)) : 1
}

function renderList (items, state, marker) {
  if (!Array.isArray(items)) return ''
  return items.map((item, i) => `${marker(i)}${renderNode(item, state)}`).join('\n')
}

function cellHeaderLabel (cell, state) {
  return renderNodes(cell?.content, state).trim()
}

// Renders a table, treating its first row as the header row and flagging any
// column whose header matches "Name"/"Names" (case-insensitive). Confluence
// tables don't always mark the header row with `tableHeader` cells (pasted or
// legacy tables commonly use plain `tableCell` with bold text instead), so row
// 0 is always used for column detection regardless of cell type. Every cell in
// a flagged column is then rendered with `redactPlainTextAsName` set, so plain
// text typed directly into that cell (not an ADF mention) is redacted too.
function renderTable (node, state) {
  const rows = Array.isArray(node.content) ? node.content : []
  const nameColumns = new Set()
  const out = []
  rows.forEach((row, rowIndex) => {
    const cells = Array.isArray(row?.content) ? row.content : []
    if (rowIndex === 0) {
      cells.forEach((cell, i) => {
        if (NAME_COLUMN_RE.test(cellHeaderLabel(cell, state))) nameColumns.add(i)
      })
      out.push(renderNodes(row.content, state))
      return
    }
    out.push(cells.map((cell, i) => {
      if (!nameColumns.has(i)) return renderNode(cell, state)
      const restore = state.redactPlainTextAsName
      state.redactPlainTextAsName = true
      const rendered = renderNodes(cell?.content, state)
      state.redactPlainTextAsName = restore
      return rendered
    }).join(''))
  })
  return out.join('')
}

function renderNode (node, state) {
  if (!node || typeof node !== 'object' || typeof node.type !== 'string') return ''
  switch (node.type) {
    case 'text': {
      const text = typeof node.text === 'string' ? node.text : ''
      const href = linkHref(node)
      if (href) return text && text !== href ? `[${text}](${href})` : href
      if (state.redactPlainTextAsName && text.trim() !== '') {
        state.warnings.push('redacted plain text in a Name-column table cell')
        return '[redacted-name]'
      }
      return text
    }
    case 'hardBreak':
      return '\n'
    case 'paragraph':
      return renderNodes(node.content, state) + '\n\n'
    case 'heading':
      return `\n${'#'.repeat(clampLevel(node.attrs?.level))} ${renderNodes(node.content, state).trim()}\n\n`
    case 'blockquote':
      return renderNodes(node.content, state).trim().split('\n').map((l) => `> ${l}`).join('\n') + '\n\n'
    case 'bulletList':
      return renderList(node.content, state, () => '- ') + '\n'
    case 'orderedList':
      return renderList(node.content, state, (i) => `${i + 1}. `) + '\n'
    case 'listItem':
    case 'taskList':
    case 'taskItem':
      return renderNodes(node.content, state).trim()
    case 'codeBlock':
      return '```' + (typeof node.attrs?.language === 'string' ? node.attrs.language : '') + '\n' + renderNodes(node.content, state) + '\n```\n\n'
    case 'panel':
    case 'expand':
    case 'nestedExpand':
      return renderNodes(node.content, state)
    case 'table':
      return renderTable(node, state)
    case 'tableRow':
    case 'tableCell':
    case 'tableHeader':
      return renderNodes(node.content, state)
    case 'rule':
      return '\n---\n'
    case 'mention':
      state.warnings.push('redacted a user mention in body')
      return '@[redacted]'
    case 'inlineCard':
    case 'blockCard':
    case 'embedCard':
      return sanitiseUrl(node.attrs?.url) || ''
    case 'emoji':
    case 'status':
      return typeof node.attrs?.text === 'string' ? node.attrs.text : ''
    case 'date':
    case 'media':
    case 'mediaSingle':
    case 'mediaGroup':
    case 'mediaInline':
      return ''
    default:
      state.warnings.push(`unknown ADF node "${node.type}" reduced to text only`)
      return renderNodes(node.content, state)
  }
}

// Redacts any email address surviving in free text (a manually typed address is
// not an ADF mention node, so the reducer would otherwise pass it through).
function redactEmails (text, warnings) {
  if (typeof text !== 'string' || text === '') return text
  if (!EMAIL_RE_G.test(text)) return text
  warnings.push('redacted one or more email addresses in body')
  return text.replace(EMAIL_RE_G, '[redacted-email]')
}

// Redacts telephone numbers typed directly into the body (e.g. in a
// "Telephone Number" table column or inline in prose).
function redactPhoneNumbers (text, warnings) {
  if (typeof text !== 'string' || text === '') return text
  if (!PHONE_RE_G.test(text)) return text
  warnings.push('redacted one or more telephone numbers in body')
  return text.replace(PHONE_RE_G, '[redacted-phone]')
}

// --- PII guards -----------------------------------------------------------

const FORBIDDEN_KEYS = new Set([
  'accountid', 'authorid', 'ownerid', 'lastownerid', 'emailaddress', 'email',
  'displayname', 'avatarurls', 'avatarurl', 'timezone', 'accounttype', 'author',
  'owner', 'createdby', 'updatedby', 'creator', 'watches', 'watchers', 'likes',
  'self', 'mention', 'username', 'profilepicture'
])

export function scanForPii (value, path = '$', out = [], seen = new WeakSet()) {
  if (value == null) return out
  if (typeof value === 'string') {
    if (EMAIL_RE.test(value)) out.push({ path, reason: 'email address in value' })
    if (ACCOUNT_ID_RE.test(value)) out.push({ path, reason: 'accountId in value' })
    return out
  }
  if (typeof value !== 'object' || seen.has(value)) return out
  seen.add(value)
  if (Array.isArray(value)) {
    value.forEach((item, i) => scanForPii(item, `${path}[${i}]`, out, seen))
    return out
  }
  for (const [key, val] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key.toLowerCase())) out.push({ path: `${path}.${key}`, reason: 'forbidden identity key' })
    scanForPii(val, `${path}.${key}`, out, seen)
  }
  return out
}

function assertNoPii (value) {
  const violations = scanForPii(value)
  if (violations.length > 0) {
    throw new SafeError(`PII guard blocked output: ${violations.map((v) => `${v.path} (${v.reason})`).join(', ')}`, { code: 'ERR_PII_LEAK' })
  }
  return value
}

// --- Allowlist ------------------------------------------------------------

const ALLOWED_ITEM_KEYS = new Set([
  'schemaVersion', 'pageId', 'title', 'status', 'spaceId', 'parentId', 'body',
  'labels', 'attachments', 'sourceConfluenceUrl', 'provenance',
  'truncated', 'sanitisationWarnings', 'error', 'notes'
])

function safeString (value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

function safeId (value) {
  const s = String(value ?? '')
  return ID_RE.test(s) ? s : null
}

function safeFilename (name) {
  if (typeof name !== 'string' || name.trim() === '') return 'attachment'
  const base = name.replace(/^.*[\\/]/, '').replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '').slice(0, 128)
  return base || 'attachment'
}

function extensionOf (filename) {
  const m = /\.([A-Za-z0-9]+)$/.exec(filename)
  return m ? m[1].toLowerCase() : ''
}

// Confluence v2 attachment ids look like "att123456"; keep them as opaque, safe
// tokens. Author/version identity on the attachment is never emitted.
function sanitiseAttachments (raw, warnings) {
  if (!Array.isArray(raw)) return []
  const out = []
  for (const att of raw) {
    if (!att || typeof att !== 'object') continue
    const id = safeString(String(att.id ?? ''))
    if (!id || !/^[A-Za-z0-9._-]{1,64}$/.test(id)) { warnings.push('dropped an attachment with an invalid id'); continue }
    const filename = safeFilename(att.title)
    out.push({
      id,
      safeFilename: filename,
      mediaType: safeString(att.mediaType) ?? 'application/octet-stream',
      size: Number.isInteger(att.fileSize) && att.fileSize >= 0 ? att.fileSize : null,
      isDesignAsset: DESIGN_EXTENSIONS.has(extensionOf(filename))
    })
  }
  return out
}

function sanitiseLabels (labels) {
  const results = labels?.results
  if (!Array.isArray(results)) return []
  return results
    .map((l) => safeString(l?.name))
    .filter((n) => typeof n === 'string' && /^[^\s]{1,255}$/.test(n))
}

function assertItemShape (record) {
  for (const key of Object.keys(record)) {
    if (!ALLOWED_ITEM_KEYS.has(key)) throw new Error(`sanitiser produced an unexpected key "${key}"`)
  }
  return record
}

// Parses the ADF body, which the v2 API returns as a JSON string inside
// `body.atlas_doc_format.value`.
function parseAdfBody (rawPage, warnings) {
  const value = rawPage?.body?.atlas_doc_format?.value
  if (value == null || value === '') return null
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch {
    warnings.push('body ADF could not be parsed; omitted')
    return null
  }
}

function buildSourceUrl (rawPage, pageId, wikiBase) {
  const webui = rawPage?._links?.webui
  if (typeof webui === 'string' && webui.startsWith('/')) {
    const clean = sanitiseUrl(`${wikiBase}${webui}`)
    if (clean) return clean
  }
  return `${wikiBase}/pages/${pageId}`
}

export function sanitisePage (rawPage, rawAttachments = [], { wikiBase, retrievedAt = new Date().toISOString(), truncated = false } = {}) {
  const warnings = []
  const pageId = safeId(rawPage?.id)
  if (!pageId) throw new Error('sanitisePage: raw page is missing a valid id')

  const reduced = reduceAdf(parseAdfBody(rawPage, warnings))
  warnings.push(...reduced.warnings)
  const withoutEmails = redactEmails(reduced.text === '' ? null : reduced.text, warnings)
  const body = redactPhoneNumbers(withoutEmails, warnings)

  const core = {
    schemaVersion: SCHEMA_VERSION,
    pageId,
    title: safeString(rawPage.title),
    status: safeString(rawPage.status),
    spaceId: safeId(rawPage.spaceId),
    parentId: safeId(rawPage.parentId),
    body,
    labels: sanitiseLabels(rawPage.labels),
    attachments: sanitiseAttachments(rawAttachments, warnings),
    sourceConfluenceUrl: buildSourceUrl(rawPage, pageId, wikiBase)
  }

  const record = {
    ...core,
    error: null,
    notes: null,
    provenance: {
      retrievedAt,
      confluenceVersion: Number.isInteger(rawPage?.version?.number) ? rawPage.version.number : null,
      confluenceUpdated: safeString(rawPage?.version?.createdAt),
      sanitiserVersion: SANITISER_VERSION,
      contentHash: 'sha256:' + createHash('sha256').update(JSON.stringify(core)).digest('hex')
    },
    truncated,
    sanitisationWarnings: warnings
  }

  assertItemShape(record)
  return assertNoPii(record)
}
