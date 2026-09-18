import { createHash } from 'node:crypto'
import { SafeError } from './redactor.mjs'

// The sanitisation boundary. Deterministic, non-AI. Every raw Jira issue passes
// through sanitiseIssue() and comes out as an allowlisted, PII-free record that
// fails closed (unknown shape or surviving identity data => throw).

export const SCHEMA_VERSION = '1.0.0'
export const SANITISER_VERSION = '1.0.0'

// The only issue fields the client is allowed to request at source. Identity
// fields (assignee, reporter, creator, comment, worklog, watches, votes,
// changelog) are deliberately excluded.
export const REQUEST_FIELDS = Object.freeze([
  'summary',
  'description',
  'issuetype',
  'status',
  'priority',
  'parent',
  'subtasks',
  'issuelinks',
  'attachment',
  'labels',
  'updated'
])

const KEY_RE = /^[A-Z][A-Z0-9]+-\d+$/
const DESIGN_EXTENSIONS = new Set(['fig', 'sketch', 'xd'])

// --- URL policy -----------------------------------------------------------

// Drops query and fragment (removes tracking params and embedded identifiers).
function sanitiseUrl(raw) {
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

function isDesignUrl(url, designHostAllowlist) {
  if (!url) return false
  let host
  try {
    host = new URL(url).host.toLowerCase()
  } catch {
    return false
  }
  return designHostAllowlist.some(
    (a) => host === a.toLowerCase() || host.endsWith(`.${a.toLowerCase()}`)
  )
}

// --- ADF reduction --------------------------------------------------------

// Reduces an ADF node tree to safe plain text. `mention` nodes become
// "@[redacted]"; link/inlineCard URLs are collected (never emitted as attrs);
// unknown nodes contribute nested text only.
function reduceAdf(doc) {
  const state = { urls: new Set(), warnings: [] }
  if (
    !doc ||
    typeof doc !== 'object' ||
    doc.type !== 'doc' ||
    !Array.isArray(doc.content)
  ) {
    if (doc != null)
      {state.warnings.push('description was not valid ADF; omitted')}
    return { text: '', urls: [], warnings: state.warnings }
  }
  return {
    text: renderNodes(doc.content, state).trim(),
    urls: [...state.urls],
    warnings: state.warnings
  }
}

function renderNodes(nodes, state) {
  return Array.isArray(nodes)
    ? nodes.map((n) => renderNode(n, state)).join('')
    : ''
}

function collectMarkUrls(node, state) {
  if (!Array.isArray(node.marks)) return
  for (const mark of node.marks) {
    if (mark?.type === 'link' && typeof mark.attrs?.href === 'string') {
      const clean = sanitiseUrl(mark.attrs.href)
      if (clean) state.urls.add(clean)
    }
  }
}

function clampLevel(level) {
  const n = Number.parseInt(level, 10)
  return Number.isInteger(n) ? Math.min(6, Math.max(1, n)) : 1
}

function renderList(items, state, marker) {
  if (!Array.isArray(items)) return ''
  return items
    .map((item, i) => `${marker(i)}${renderNode(item, state)}`)
    .join('\n')
}

function renderNode(node, state) {
  if (!node || typeof node !== 'object' || typeof node.type !== 'string')
    {return ''}
  switch (node.type) {
    case 'text':
      collectMarkUrls(node, state)
      return typeof node.text === 'string' ? node.text : ''
    case 'hardBreak':
      return '\n'
    case 'paragraph':
      return renderNodes(node.content, state) + '\n\n'
    case 'heading':
      return `\n${'#'.repeat(clampLevel(node.attrs?.level))} ${renderNodes(node.content, state).trim()}\n\n`
    case 'blockquote':
      return (
        renderNodes(node.content, state)
          .trim()
          .split('\n')
          .map((l) => `> ${l}`)
          .join('\n') + '\n\n'
      )
    case 'bulletList':
      return renderList(node.content, state, () => '- ') + '\n'
    case 'orderedList':
      return renderList(node.content, state, (i) => `${i + 1}. `) + '\n'
    case 'listItem':
      return renderNodes(node.content, state).trim()
    case 'codeBlock':
      return (
        '```' +
        (typeof node.attrs?.language === 'string' ? node.attrs.language : '') +
        '\n' +
        renderNodes(node.content, state) +
        '\n```\n\n'
      )
    case 'panel':
    case 'expand':
    case 'nestedExpand':
    case 'table':
    case 'tableRow':
    case 'tableCell':
    case 'tableHeader':
      return renderNodes(node.content, state)
    case 'rule':
      return '\n---\n'
    case 'mention':
      state.warnings.push('redacted a user mention in description')
      return '@[redacted]'
    case 'inlineCard':
    case 'blockCard':
    case 'embedCard': {
      const clean = sanitiseUrl(node.attrs?.url)
      if (clean) {
        state.urls.add(clean)
        return clean
      }
      return ''
    }
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
      state.warnings.push(
        `unknown ADF node "${node.type}" reduced to text only`
      )
      return renderNodes(node.content, state)
  }
}

// Deterministic best-effort split of an "Acceptance Criteria" section. The full
// description is always returned regardless.
function extractAcceptanceCriteria(text) {
  if (typeof text !== 'string' || text === '') return []
  const headingRe = /^\s*#*\s*acceptance\s+criteria\s*:?\s*$/i
  const inlineRe = /^\s*#*\s*acceptance\s+criteria\s*:\s*(.+)$/i
  const nextHeadingRe = /^\s*#{1,6}\s+\S/
  const out = []
  let capturing = false
  for (const line of text.split('\n')) {
    const inline = line.match(inlineRe)
    if (inline) {
      capturing = true
      pushCriterion(out, inline[1])
      continue
    }
    if (headingRe.test(line)) {
      capturing = true
      continue
    }
    if (capturing) {
      if (nextHeadingRe.test(line)) break
      pushCriterion(out, line)
    }
  }
  return out
}

function pushCriterion(out, raw) {
  const cleaned = raw.replace(/^\s*(?:[-*]|\d+\.)\s*/, '').trim()
  if (cleaned) out.push(cleaned)
}

// --- PII guards -----------------------------------------------------------

const FORBIDDEN_KEYS = new Set([
  'accountid',
  'emailaddress',
  'email',
  'displayname',
  'avatarurls',
  'avatarurl',
  'timezone',
  'accounttype',
  'author',
  'updateauthor',
  'reporter',
  'assignee',
  'creator',
  'watches',
  'watchers',
  'voters',
  'votes',
  'worklog',
  'comment',
  'comments',
  'changelog',
  'histories',
  'self',
  'mention',
  'username'
])
const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/
const ACCOUNT_ID_RE = /accountId=/i

export function scanForPii(value, path = '$', out = [], seen = new WeakSet()) {
  if (value == null) return out
  if (typeof value === 'string') {
    if (EMAIL_RE.test(value))
      {out.push({ path, reason: 'email address in value' })}
    if (ACCOUNT_ID_RE.test(value))
      {out.push({ path, reason: 'accountId in value' })}
    return out
  }
  if (typeof value !== 'object' || seen.has(value)) return out
  seen.add(value)
  if (Array.isArray(value)) {
    value.forEach((item, i) => scanForPii(item, `${path}[${i}]`, out, seen))
    return out
  }
  for (const [key, val] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key.toLowerCase()))
      {out.push({ path: `${path}.${key}`, reason: 'forbidden identity key' })}
    scanForPii(val, `${path}.${key}`, out, seen)
  }
  return out
}

function assertNoPii(value) {
  const violations = scanForPii(value)
  if (violations.length > 0) {
    throw new SafeError(
      `PII guard blocked output: ${violations.map((v) => `${v.path} (${v.reason})`).join(', ')}`,
      { code: 'ERR_PII_LEAK' }
    )
  }
  return value
}

// --- Allowlist ------------------------------------------------------------

const ALLOWED_ITEM_KEYS = new Set([
  'schemaVersion',
  'ticketKey',
  'ticketType',
  'summary',
  'description',
  'acceptanceCriteria',
  'status',
  'priority',
  'parent',
  'children',
  'links',
  'attachments',
  'designUrls',
  'labels',
  'sourceJiraUrl',
  'provenance',
  'truncated',
  'sanitisationWarnings',
  'error',
  'notes'
])

export function safeKey(value) {
  return typeof value === 'string' && KEY_RE.test(value) ? value : null
}

function safeString(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

function safeFilename(name) {
  if (typeof name !== 'string' || name.trim() === '') return 'attachment'
  const base = name
    .replace(/^.*[\\/]/, '')
    .replace(/[^A-Za-z0-9._-]/g, '_')
    .replace(/^\.+/, '')
    .slice(0, 128)
  return base || 'attachment'
}

function extensionOf(filename) {
  const m = /\.([A-Za-z0-9]+)$/.exec(filename)
  return m ? m[1].toLowerCase() : ''
}

function sanitiseAttachments(raw, warnings) {
  if (!Array.isArray(raw)) return []
  const out = []
  for (const att of raw) {
    if (!att || typeof att !== 'object') continue
    const id = safeString(String(att.id ?? ''))
    if (!id || !/^\d+$/.test(id)) {
      warnings.push('dropped an attachment with an invalid id')
      continue
    }
    const filename = safeFilename(att.filename)
    out.push({
      id,
      safeFilename: filename,
      mimeType: safeString(att.mimeType) ?? 'application/octet-stream',
      size: Number.isInteger(att.size) && att.size >= 0 ? att.size : null,
      isDesignAsset: DESIGN_EXTENSIONS.has(extensionOf(filename))
    })
  }
  return out
}

function sanitiseParent(parent) {
  if (!parent || typeof parent !== 'object') return null
  const key = safeKey(parent.key)
  return key
    ? { key, type: safeString(parent.fields?.issuetype?.name) ?? null }
    : null
}

function sanitiseChildren(subtasks, warnings) {
  if (!Array.isArray(subtasks)) return []
  const out = []
  for (const st of subtasks) {
    const key = safeKey(st?.key)
    if (!key) {
      if (st != null) warnings.push('dropped a child with an invalid key')
      continue
    }
    out.push({ key, type: safeString(st.fields?.issuetype?.name) ?? null })
  }
  return out
}

function sanitiseLinks(issuelinks, warnings) {
  if (!Array.isArray(issuelinks)) return []
  const out = []
  for (const link of issuelinks) {
    if (!link || typeof link !== 'object') continue
    const outward = link.outwardIssue
    const target = outward ?? link.inwardIssue
    const key = safeKey(target?.key)
    if (!key) {
      warnings.push('dropped a link with an invalid target key')
      continue
    }
    out.push({
      key,
      type: safeString(link.type?.name) ?? null,
      direction: outward ? 'outward' : 'inward'
    })
  }
  return out
}

function sanitiseLabels(labels) {
  return Array.isArray(labels)
    ? labels.filter((l) => typeof l === 'string' && /^[^\s]{1,255}$/.test(l))
    : []
}

function assertItemShape(record) {
  for (const key of Object.keys(record)) {
    if (!ALLOWED_ITEM_KEYS.has(key))
      {throw new Error(`sanitiser produced an unexpected key "${key}"`)}
  }
  return record
}

export function sanitiseIssue(
  rawIssue,
  {
    baseUrl,
    designHostAllowlist = [],
    retrievedAt = new Date().toISOString(),
    leafTicketTypes = []
  } = {}
) {
  const warnings = []
  const key = safeKey(rawIssue?.key)
  if (!key) throw new Error('sanitiseIssue: raw issue is missing a valid key')
  const fields = rawIssue.fields ?? {}

  const ticketType = safeString(fields.issuetype?.name)
  // Leaf work items (Story/Spike/Bug) expose no children: their only children
  // are sub-tasks, which this skill never surfaces.
  const leafSet = new Set(
    (leafTicketTypes || []).map((t) => String(t).toLowerCase())
  )
  const isLeaf = !!ticketType && leafSet.has(ticketType.toLowerCase())

  const reduced = reduceAdf(fields.description)
  warnings.push(...reduced.warnings)
  const description = reduced.text === '' ? null : reduced.text

  const designUrls = reduced.urls
    .map(sanitiseUrl)
    .filter(Boolean)
    .filter((u) => isDesignUrl(u, designHostAllowlist))
    .map((url) => ({ url, source: 'description' }))

  const core = {
    schemaVersion: SCHEMA_VERSION,
    ticketKey: key,
    ticketType,
    summary: safeString(fields.summary),
    description,
    acceptanceCriteria: extractAcceptanceCriteria(reduced.text),
    status: safeString(fields.status?.name),
    priority: safeString(fields.priority?.name),
    parent: sanitiseParent(fields.parent),
    children: isLeaf ? [] : sanitiseChildren(fields.subtasks, warnings),
    links: sanitiseLinks(fields.issuelinks, warnings),
    attachments: sanitiseAttachments(fields.attachment, warnings),
    designUrls,
    labels: sanitiseLabels(fields.labels),
    sourceJiraUrl: `${baseUrl}/browse/${key}`
  }

  const record = {
    ...core,
    // Agent-facing annotations, set by callers (e.g. contextual-parent notes).
    error: null,
    notes: null,
    provenance: {
      retrievedAt,
      jiraUpdated: safeString(fields.updated),
      sanitiserVersion: SANITISER_VERSION,
      contentHash:
        'sha256:' +
        createHash('sha256').update(JSON.stringify(core)).digest('hex')
    },
    truncated: false,
    sanitisationWarnings: warnings
  }

  assertItemShape(record)
  return assertNoPii(record)
}
