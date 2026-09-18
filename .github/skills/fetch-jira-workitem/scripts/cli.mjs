#!/usr/bin/env node
import { writeFileSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadConfig } from './config.mjs'
import { createJiraClient, parseTicketRef } from './jira.mjs'
import {
  resolveHierarchy,
  buildIndex,
  buildItemDocument,
  buildDetailSet
} from './traverse.mjs'
import { sanitiseIssue, SCHEMA_VERSION } from './sanitise.mjs'
import { redactString } from './redactor.mjs'

// Agent-facing entry point. Prints ONLY sanitised JSON to stdout. Errors go to
// stderr, redacted. This is the single surface the agent is allowed to use.

// Auto `--out` writes inside the skill (never outside the workspace/temp dir).
const SKILL_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CACHE_DIR = resolve(SKILL_ROOT, '.cache')

const USAGE = `Usage:
  node scripts/cli.mjs <url|key>                 # hierarchy index (traverses children/links)
  node scripts/cli.mjs <url|key> --no-traverse   # only the given ticket (full detail, no traversal)
  node scripts/cli.mjs details <url|key>         # full detail for EVERY item in the hierarchy
  node scripts/cli.mjs details <url|key> --no-traverse  # full detail for the given ticket only
  node scripts/cli.mjs item <url|key>            # full sanitised work item (single ticket)

Options:
  --out [path]   write the full JSON to a file and print only a compact summary
                 to stdout. With no path it writes to the skill's .cache/ folder
                 (inside the workspace); pass a path to choose the location.
                 Use for large epics so terminal output is never truncated;
                 then read the file and delete it when done.`

// Validates the ref against the configured Jira site.
const parseRef = (ref, config) =>
  parseTicketRef(ref, { expectedHost: config.egressHosts[0] })

// Sanitiser options derived from config (shared by the single-item paths).
const sanitiseOpts = (config) => ({
  baseUrl: config.baseUrl,
  designHostAllowlist: config.designHostAllowlist,
  leafTicketTypes: config.leafTicketTypes
})

async function runIndex(ref, config) {
  const client = createJiraClient(config)
  const hierarchy = await resolveHierarchy(parseRef(ref, config), {
    client,
    config
  })
  return buildIndex(hierarchy)
}

async function runItem(ref, config) {
  const client = createJiraClient(config)
  const key = parseRef(ref, config)
  const raw = await client.getIssue(key)
  if (!raw) throw new Error(`Issue ${key} was not found or is not accessible.`)
  return buildItemDocument(sanitiseIssue(raw, sanitiseOpts(config)))
}

// Stage 2: full detail for the whole hierarchy (or just the root when traversal
// is disabled), always returned as a `work-item-set`. A missing/inaccessible
// ticket yields a single error stub rather than an empty set.
async function runDetails(ref, config, traverse) {
  if (!traverse) {
    const client = createJiraClient(config)
    const key = parseRef(ref, config)
    const raw = await client.getIssue(key)
    const items = raw
      ? [buildItemDocument(sanitiseIssue(raw, sanitiseOpts(config)))]
      : [{ ticketKey: key, error: 'Issue was not found or is not accessible.' }]
    return {
      schemaVersion: SCHEMA_VERSION,
      kind: 'work-item-set',
      root: key,
      retrievedAt: new Date().toISOString(),
      count: items.length,
      truncated: false,
      warnings: [],
      items
    }
  }
  const client = createJiraClient(config)
  const hierarchy = await resolveHierarchy(parseRef(ref, config), {
    client,
    config
  })
  return buildDetailSet(hierarchy)
}

// Splits positional args from flags. `--no-traverse`/`--traverse=false` disable
// hierarchy traversal so only the given ticket is fetched. Unknown flags are
// rejected so a typo can never be misread as a ticket reference.
function parseArgs(argv) {
  const positionals = []
  const unknownFlags = []
  let traverse = true
  let outPath // undefined = stdout; true = auto temp file; string = explicit path
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--no-traverse' || arg === '--traverse=false') traverse = false
    else if (arg === '--traverse=true') traverse = true
    else if (arg === '-h' || arg === '--help') positionals.push('--help')
    else if (arg.startsWith('--out=')) outPath = arg.slice(6)
    else if (arg === '--out' || arg === '-o') {
      const next = argv[i + 1]
      if (next && !next.startsWith('-')) {
        outPath = next
        i += 1
      } else outPath = true
    } else if (arg.startsWith('-')) unknownFlags.push(arg)
    else positionals.push(arg)
  }
  return { positionals, traverse, unknownFlags, outPath }
}

// Emits the result: either the full JSON to stdout, or (with --out) the full
// JSON to a file plus a compact summary to stdout so huge epics never overflow
// the terminal.
function emit(result, outPath) {
  const json = JSON.stringify(result, null, 2)
  if (outPath === undefined) {
    process.stdout.write(json + '\n')
    return
  }
  const root = result.root ?? result.ticketKey ?? 'jira'
  let file
  if (outPath === true) {
    mkdirSync(CACHE_DIR, { recursive: true })
    // Stable per-root name so re-runs overwrite instead of accumulating files.
    file = resolve(CACHE_DIR, `jira-${root}.json`)
  } else {
    file = resolve(outPath)
  }
  writeFileSync(file, json)
  const summary = {
    ok: true,
    kind: result.kind,
    root,
    count: result.count ?? result.items?.length ?? 1,
    truncated: result.truncated ?? false,
    warnings: result.warnings ?? [],
    outputFile: file,
    bytes: Buffer.byteLength(json),
    note: 'Full sanitised JSON written to outputFile; read it from there, then delete it (stdout is intentionally compact).'
  }
  process.stdout.write(JSON.stringify(summary, null, 2) + '\n')
}

async function main() {
  const { positionals, traverse, unknownFlags, outPath } = parseArgs(
    process.argv.slice(2)
  )
  if (unknownFlags.length > 0) {
    process.stderr.write(
      JSON.stringify({
        error: `Unknown option(s): ${unknownFlags.join(', ')}`,
        code: 'ERR_INPUT'
      }) + '\n'
    )
    process.exit(1)
  }
  if (positionals.length === 0 || positionals[0] === '--help') {
    process.stdout.write(USAGE + '\n')
    process.exit(positionals.length === 0 ? 1 : 0)
  }
  const config = loadConfig()
  let result
  if (positionals[0] === 'item') result = await runItem(positionals[1], config)
  else if (positionals[0] === 'details')
    {result = await runDetails(positionals[1], config, traverse)}
  else if (!traverse) result = await runItem(positionals[0], config)
  else result = await runIndex(positionals[0], config)
  emit(result, outPath)
}

main().catch((err) => {
  const message = redactString(String(err?.message ?? err))
  const code = typeof err?.code === 'string' ? err.code : 'ERR'
  process.stderr.write(JSON.stringify({ error: message, code }) + '\n')
  process.exit(1)
})
