import { sanitiseIssue, safeKey, SCHEMA_VERSION } from './sanitise.mjs'

// Classifies a raw issue against the configured type policy using Jira's
// `issuetype.hierarchyLevel` (1+ = epic/initiative container, 0 = standard
// story/task/bug level, -1 = sub-task) with a name-based fallback:
//  - leaf   => a standard-level type on the leaf allowlist (story/spike/bug).
//              Collected into the output, but never expanded.
//  - container => an above-standard type (epic/initiative). Traversed through
//              to reach leaves, and also collected into the output.
//  - excluded => everything else (Task, Sub-task, etc.): never collected and
//              never expanded, so sub-tasks and tasks never reach the agent.
function classifyType(raw, { leafTypes, containerTypes }) {
  const issuetype = raw?.fields?.issuetype ?? {}
  const name =
    typeof issuetype.name === 'string'
      ? issuetype.name.trim().toLowerCase()
      : ''
  const level = Number(issuetype.hierarchyLevel)
  const hasLevel = Number.isFinite(level)
  const isSubtask = hasLevel ? level < 0 : issuetype.subtask === true
  const isLeaf = !isSubtask && leafTypes.has(name)
  const isContainer =
    !isSubtask && ((hasLevel && level >= 1) || containerTypes.has(name))
  return { name, isSubtask, isLeaf, isContainer }
}

// Bounded, cycle-safe breadth-first traversal of a work-item hierarchy:
//  - `seen` suppresses duplicate/circular references,
//  - `maxDepth` bounds child expansion, `maxIssues` caps total retrieval,
//  - only container types are expanded, and only leaf/container types are
//    collected, so Tasks and sub-tasks are neither fetched nor emitted,
//  - the root is always collected (whatever its type); the root's parent, and
//    the links of expanded items, are context only (collected if leaf/container
//    but never expanded),
//  - keys are processed in deterministic sorted order.
export async function resolveHierarchy(rootKey, { client, config }) {
  const root = safeKey(rootKey)
  if (!root) throw new Error('resolveHierarchy: invalid root key')

  const retrievedAt = new Date().toISOString()
  const opts = {
    baseUrl: config.baseUrl,
    designHostAllowlist: config.designHostAllowlist,
    retrievedAt,
    leafTicketTypes: config.leafTicketTypes
  }
  const typePolicy = {
    leafTypes: new Set(config.leafTicketTypes),
    containerTypes: new Set(config.containerTicketTypes)
  }
  const items = new Map()
  const order = []
  const warnings = []
  const seen = new Set()
  const rawCache = new Map()
  const queue = []
  let truncated = false

  const enqueue = (key, depth, expand, relation) => {
    const k = safeKey(key)
    if (!k || seen.has(k)) return
    seen.add(k)
    queue.push({ key: k, depth, expand, relation })
  }

  async function getRaw(key) {
    if (rawCache.has(key)) return rawCache.get(key)
    const raw = await client.getIssue(key)
    if (raw) rawCache.set(key, raw)
    return raw
  }

  enqueue(root, 0, true, 'root')

  while (queue.length > 0) {
    if (items.size >= config.maxIssues) {
      truncated = true
      break
    }
    const { key, depth, expand, relation } = queue.shift()
    const raw = await getRaw(key)
    if (!raw) {
      warnings.push(`skipped inaccessible or missing issue ${key}`)
      continue
    }

    const kind = classifyType(raw, typePolicy)
    const isRoot = relation === 'root'
    // Type filter: only the root, leaf types, and container types are emitted.
    if (!isRoot && !kind.isLeaf && !kind.isContainer) {
      warnings.push(
        `excluded ${key} (type "${kind.name || 'unknown'}") — not a collected leaf or container type`
      )
      continue
    }

    let record
    try {
      record = sanitiseIssue(raw, opts)
    } catch {
      warnings.push(`omitted ${key}: could not be sanitised safely`)
      continue
    }
    record.relation = relation
    record.depth = depth
    // Parent items are extended context; flag them so the consuming agent can
    // tell them apart from the requested work item(s).
    if (relation === 'parent') record.notes = 'Details for contextual purpose'
    items.set(key, record)
    order.push(key)

    // Only defined types (leaf/container) carry parent context; an undefined
    // root (e.g. Task/Sub-task) returns on its own with no parent or traversal.
    if (isRoot && (kind.isLeaf || kind.isContainer) && record.parent)
      {enqueue(record.parent.key, 0, false, 'parent')}
    // Only containers are expanded; leaves and excluded types stop here so
    // sub-tasks and tasks below them are never fetched.
    if (!expand || depth >= config.maxDepth || !kind.isContainer) continue

    const childKeys = new Set(record.children.map((c) => c.key))
    let searched = []
    try {
      searched = await client.searchChildren(key)
    } catch {
      warnings.push(`could not search children of ${key}`)
    }
    for (const rawChild of searched) {
      const ck = safeKey(rawChild?.key)
      if (ck) {
        childKeys.add(ck)
        if (!rawCache.has(ck)) rawCache.set(ck, rawChild)
      }
    }
    for (const ck of [...childKeys].sort((a, b) => a.localeCompare(b)))
      {enqueue(ck, depth + 1, true, 'child')}
    for (const link of [...record.links].sort((a, b) =>
      a.key.localeCompare(b.key)
    )) {
      enqueue(link.key, depth + 1, false, `link:${link.type ?? 'related'}`)
    }
  }

  // Empty order means the root itself could not be retrieved; surface it so
  // callers can return an error stub instead of an empty result.
  const rootError =
    order.length === 0
      ? 'The requested Jira ticket was not found or is not accessible.'
      : null
  return { root, order, items, warnings, truncated, retrievedAt, rootError }
}

// Compact hierarchy index for progressive disclosure (stage 1). Already sanitised.
export function buildIndex(hierarchy) {
  const { root, order, items, warnings, truncated, retrievedAt, rootError } =
    hierarchy
  const index =
    order.length === 0
      ? [{ key: root, error: rootError }]
      : order.map((key) => {
          const it = items.get(key)
          return {
            key,
            ticketType: it.ticketType,
            summary: it.summary,
            status: it.status,
            depth: it.depth,
            relation: it.relation,
            notes: it.notes ?? null,
            parentKey: it.parent?.key ?? null,
            linkKeys: it.links.map((l) => l.key),
            attachmentCount: it.attachments.length,
            designUrlCount: it.designUrls.length
          }
        })
  return {
    schemaVersion: SCHEMA_VERSION,
    kind: 'hierarchy-index',
    root,
    retrievedAt,
    count: index.length,
    truncated,
    warnings,
    index
  }
}

export function buildItemDocument(record) {
  return { schemaVersion: SCHEMA_VERSION, kind: 'work-item', ...record }
}

// Full-detail set for stage 2: the complete sanitised work-item for every item
// discovered by traversal (in the same order as the index), so the agent gets
// full context on the whole epic/story set rather than a single ticket. Records
// are already fully sanitised by resolveHierarchy.
export function buildDetailSet(hierarchy) {
  const { root, order, items, warnings, truncated, retrievedAt, rootError } =
    hierarchy
  const documents =
    order.length === 0
      ? [{ ticketKey: root, error: rootError }]
      : order.map((key) => buildItemDocument(items.get(key)))
  return {
    schemaVersion: SCHEMA_VERSION,
    kind: 'work-item-set',
    root,
    retrievedAt,
    count: documents.length,
    truncated,
    warnings,
    items: documents
  }
}
