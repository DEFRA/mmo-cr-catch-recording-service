#!/usr/bin/env node
import { writeFileSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadConfig } from './config.mjs'
import { createConfluenceClient, parsePageRef } from './confluence.mjs'
import { sanitisePage, SCHEMA_VERSION } from './sanitise.mjs'
import { redactString } from './redactor.mjs'

// Agent-facing entry point. Prints ONLY sanitised JSON to stdout. Errors go to
// stderr, redacted. This is the single surface the agent is allowed to use.

// Auto `--out` writes inside the skill (never outside the workspace/temp dir).
const SKILL_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CACHE_DIR = resolve(SKILL_ROOT, '.cache')

const USAGE = `Usage:
  node scripts/cli.mjs <url|id>                  # full sanitised page (body + labels + attachments)
  node scripts/cli.mjs <url|id> --no-attachments # skip attachment descriptors (one fewer request)

Options:
  --out [path]        write the full JSON to a file and print only a compact
                      summary to stdout. With no path it writes to the skill's
                      .cache/ folder (inside the workspace); pass a path to
                      choose the location. The file is kept on disk (one per
                      page id, overwritten on re-run) so it can be reused.
  --no-attachments    do not fetch attachment descriptors for the page.

Only the single page identified by <url|id> is fetched. Child, related and
linked pages are never fetched or traversed.`

async function runPage (ref, config, withAttachments) {
  const client = createConfluenceClient(config)
  const pageId = parsePageRef(ref, { expectedHost: config.egressHosts[0] })
  const rawPage = await client.getPage(pageId)
  if (!rawPage) {
    return { schemaVersion: SCHEMA_VERSION, kind: 'confluence-page', pageId, error: 'Page was not found or is not accessible.' }
  }
  let attachments = []
  let truncated = false
  if (withAttachments) {
    const result = await client.getAttachments(pageId)
    attachments = result.attachments
    truncated = result.truncated
  }
  const record = sanitisePage(rawPage, attachments, {
    wikiBase: config.wikiBase,
    truncated
  })
  return { schemaVersion: SCHEMA_VERSION, kind: 'confluence-page', ...record }
}

// Splits positional args from flags. Unknown flags are rejected so a typo can
// never be misread as a page reference.
function parseArgs (argv) {
  const positionals = []
  const unknownFlags = []
  let withAttachments = true
  let outPath // undefined = stdout; true = auto cache file; string = explicit path
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--no-attachments') withAttachments = false
    else if (arg === '-h' || arg === '--help') positionals.push('--help')
    else if (arg.startsWith('--out=')) outPath = arg.slice(6)
    else if (arg === '--out' || arg === '-o') {
      const next = argv[i + 1]
      if (next && !next.startsWith('-')) { outPath = next; i += 1 } else outPath = true
    } else if (arg.startsWith('-')) unknownFlags.push(arg)
    else positionals.push(arg)
  }
  return { positionals, withAttachments, unknownFlags, outPath }
}

// Emits the result: either the full JSON to stdout, or (with --out) the full
// JSON to a file plus a compact summary to stdout so large pages never overflow
// the terminal.
function emit (result, outPath) {
  const json = JSON.stringify(result, null, 2)
  if (outPath === undefined) { process.stdout.write(json + '\n'); return }
  const id = result.pageId ?? 'page'
  let file
  if (outPath === true) {
    mkdirSync(CACHE_DIR, { recursive: true })
    // Stable per-page name so re-runs overwrite instead of accumulating files.
    file = resolve(CACHE_DIR, `confluence-${id}.json`)
  } else {
    file = resolve(outPath)
  }
  writeFileSync(file, json)
  const summary = {
    ok: true,
    kind: result.kind,
    pageId: id,
    title: result.title ?? null,
    truncated: result.truncated ?? false,
    warnings: result.sanitisationWarnings ?? [],
    error: result.error ?? null,
    outputFile: file,
    bytes: Buffer.byteLength(json),
    note: 'Full sanitised JSON written to outputFile; read it from there. The file is kept in .cache/ (overwritten on re-run) for reuse, not deleted.'
  }
  process.stdout.write(JSON.stringify(summary, null, 2) + '\n')
}

async function main () {
  const { positionals, withAttachments, unknownFlags, outPath } = parseArgs(process.argv.slice(2))
  if (unknownFlags.length > 0) {
    process.stderr.write(JSON.stringify({ error: `Unknown option(s): ${unknownFlags.join(', ')}`, code: 'ERR_INPUT' }) + '\n')
    process.exit(1)
  }
  if (positionals.length === 0 || positionals[0] === '--help') {
    process.stdout.write(USAGE + '\n')
    process.exit(positionals.length === 0 ? 1 : 0)
  }
  const config = loadConfig()
  const result = await runPage(positionals[0], config, withAttachments)
  emit(result, outPath)
}

main().catch((err) => {
  const message = redactString(String(err?.message ?? err))
  const code = typeof err?.code === 'string' ? err.code : 'ERR'
  process.stderr.write(JSON.stringify({ error: message, code }) + '\n')
  process.exit(1)
})
