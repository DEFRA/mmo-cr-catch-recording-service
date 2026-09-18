import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SafeError } from './redactor.mjs'

// Loads and validates configuration for the skill. API-token (Basic auth) only —
// the same Atlassian account/token used by Jira. Secrets are held only in the
// returned object (in memory) and never logged. The .env file lives in the skill
// root and must never be read by the agent.

const SKILL_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ENV_FILE = resolve(SKILL_ROOT, '.env')

const DEFAULTS = {
  maxAttachments: 200
}

// Minimal KEY=VALUE .env reader. Values already present in the environment win.
function loadEnvFile (env) {
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
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    merged[m[1]] = val
  }
  return merged
}

function requireEnv (env, name) {
  const value = env[name]
  if (typeof value !== 'string' || value.trim() === '') {
    throw new SafeError(
      `Missing required configuration "${name}". Set it in the skill's .env file (see assets/.env.example).`,
      { code: 'ERR_CONFIG_MISSING' }
    )
  }
  return value.trim()
}

function parsePositiveInt (raw, fallback) {
  const n = Number.parseInt(raw, 10)
  return Number.isInteger(n) && n > 0 ? n : fallback
}

// Parses the site URL and derives the Confluence Cloud REST base. Accepts the
// site root or a URL already ending in /wiki; always normalises to `.../wiki`.
function parseSite (raw) {
  let url
  try {
    url = new URL(raw)
  } catch {
    throw new SafeError('CONFLUENCE_BASE_URL is not a valid URL.', { code: 'ERR_CONFIG_INVALID' })
  }
  if (url.protocol !== 'https:') throw new SafeError('CONFLUENCE_BASE_URL must use https.', { code: 'ERR_CONFIG_INVALID' })
  const path = url.pathname.replace(/\/+$/, '')
  const wikiBase = /\/wiki$/.test(path)
    ? `${url.protocol}//${url.host}${path}`
    : `${url.protocol}//${url.host}${path}/wiki`
  return { wikiBase, host: url.host }
}

export function loadConfig (rawEnv = process.env) {
  const env = loadEnvFile(rawEnv)
  const site = parseSite(requireEnv(env, 'CONFLUENCE_BASE_URL'))

  return Object.freeze({
    wikiBase: site.wikiBase,
    apiBase: `${site.wikiBase}/api/v2`,
    // Egress is locked to the Confluence site host only (blocks SSRF and external fetches).
    egressHosts: Object.freeze([site.host]),
    email: requireEnv(env, 'CONFLUENCE_EMAIL'),
    apiToken: requireEnv(env, 'CONFLUENCE_API_TOKEN'),
    maxAttachments: parsePositiveInt(env.CONFLUENCE_MAX_ATTACHMENTS, DEFAULTS.maxAttachments)
  })
}
