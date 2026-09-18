import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SafeError } from './redactor.mjs'

// Loads and validates configuration for the skill. API-token (Basic auth) only.
// Secrets are held only in the returned object (in memory) and never logged.
// The .env file lives in the skill root and must never be read by the agent.

const SKILL_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ENV_FILE = resolve(SKILL_ROOT, '.env')

const DEFAULTS = {
  maxDepth: 5,
  maxIssues: 100,
  designHostAllowlist: ['figma.com'],
  // Standard-level (hierarchyLevel 0) types that are collected but never
  // expanded. Anything else at that level (e.g. Task) is excluded from output.
  leafTicketTypes: ['story', 'spike', 'bug'],
  // Above-standard (hierarchyLevel >= 1) container types that are traversed
  // through to reach leaves. Used as a name fallback when hierarchyLevel is
  // absent.
  containerTicketTypes: ['epic', 'initiative']
}

// Minimal KEY=VALUE .env reader. Values already present in the environment win.
function loadEnvFile(env) {
  let text
  try {
    text = readFileSync(ENV_FILE, 'utf8')
  } catch {
    return env
  }
  const merged = { ...env }
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/)
    if (!m) continue
    if (merged[m[1]] != null && merged[m[1]] !== '') continue
    let val = m[2].trim()
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1)
    }
    merged[m[1]] = val
  }
  return merged
}

function requireEnv(env, name) {
  const value = env[name]
  if (typeof value !== 'string' || value.trim() === '') {
    throw new SafeError(
      `Missing required configuration "${name}". Set it in the skill's .env file (see assets/.env.example).`,
      { code: 'ERR_CONFIG_MISSING' }
    )
  }
  return value.trim()
}

function parsePositiveInt(raw, fallback) {
  const n = Number.parseInt(raw, 10)
  return Number.isInteger(n) && n > 0 ? n : fallback
}

function parseTypeList(raw, fallback) {
  const list = String(raw ?? '')
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean)
  return list.length ? list : fallback
}

function parseSite(raw) {
  let url
  try {
    url = new URL(raw)
  } catch {
    throw new SafeError('JIRA_BASE_URL is not a valid URL.', {
      code: 'ERR_CONFIG_INVALID'
    })
  }
  if (url.protocol !== 'https:')
    {throw new SafeError('JIRA_BASE_URL must use https.', {
      code: 'ERR_CONFIG_INVALID'
    })}
  // Preserve any sub-path (some Jira sites are hosted under a path) while
  // dropping trailing slashes so request URLs join cleanly.
  const path = url.pathname.replace(/\/+$/, '')
  return { baseUrl: `${url.protocol}//${url.host}${path}`, host: url.host }
}

export function loadConfig(rawEnv = process.env) {
  const env = loadEnvFile(rawEnv)
  const site = parseSite(requireEnv(env, 'JIRA_BASE_URL'))
  const designHostAllowlist = (env.JIRA_DESIGN_HOST_ALLOWLIST ?? '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean)

  // Leaf types win over container types so an overlapping entry can never make
  // a leaf (e.g. Story) be expanded into its sub-tasks.
  const leafTicketTypes = parseTypeList(
    env.JIRA_LEAF_TICKET_TYPES,
    DEFAULTS.leafTicketTypes
  )
  const containerTicketTypes = parseTypeList(
    env.JIRA_CONTAINER_TICKET_TYPES,
    DEFAULTS.containerTicketTypes
  ).filter((t) => !leafTicketTypes.includes(t))

  return Object.freeze({
    baseUrl: site.baseUrl,
    // Egress is locked to the Jira site host only (blocks SSRF and design fetches).
    egressHosts: Object.freeze([site.host]),
    email: requireEnv(env, 'JIRA_EMAIL'),
    apiToken: requireEnv(env, 'JIRA_API_TOKEN'),
    maxDepth: parsePositiveInt(env.JIRA_MAX_DEPTH, DEFAULTS.maxDepth),
    maxIssues: parsePositiveInt(env.JIRA_MAX_ISSUES, DEFAULTS.maxIssues),
    designHostAllowlist: designHostAllowlist.length
      ? designHostAllowlist
      : DEFAULTS.designHostAllowlist,
    leafTicketTypes: Object.freeze(leafTicketTypes),
    containerTicketTypes: Object.freeze(containerTicketTypes)
  })
}
