---
name: fetch-jira-workitem
description: 'Fetches a Jira Cloud ticket and its work-item hierarchy by URL or key and returns only sanitised, PII-free data (summary, description, acceptance criteria, statuses, parent/child/linked references, attachment descriptors, design-URL references). Use when reading a Jira ticket to understand or implement work, or when the user provides a Jira ticket URL or key. Connects only to Jira; never downloads attachments or fetches design pages.'
argument-hint: '<jira-ticket-url-or-key>'
user-invocable: true
---

# Fetch Jira work item

Retrieves Jira Cloud ticket details through a deterministic security boundary
that strips all personal and identity data before any result reaches the agent.

## Hard rules (non-negotiable)

- Never read, open, print, or echo the skill's `.env` file or any credential.
- On an auth/credential error, do not inspect `.env`; tell the user:
  "Jira credentials appear to be missing or invalid — please check the `.env`
  file in the skill folder."
- Consume only the JSON printed to stdout by the CLI. Never read internal state.
- Connect only to Jira. Do not open or fetch design URLs (Figma etc.); they are
  returned as reference strings for a human.
- Start fresh every time. When the user asks to pull ticket details again — the
  same ticket or another — do not reuse anything from memory or a previous run
  (no cached output, keys, hierarchy, or answers). Re-run the procedure from
  step 0 and re-ask every prerequisite question before calling the CLI.

## When to use

- The user gives a Jira ticket URL or key and wants to understand/implement it.
- You need a ticket's summary, description, acceptance criteria, hierarchy, or
  safe attachment/design references.

## Setup (human, one-time)

1. Copy [assets/.env.example](assets/.env.example) to `.env` in this skill folder.
2. Create an API token at https://id.atlassian.com/manage-profile/security/api-tokens
   (prefer a low-privilege account with only _Browse projects_).
3. Set `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN` in `.env`.

Requires Node.js 18+ (built-in `fetch`). No dependencies, no install.

## Procedure (progressive disclosure)

0. Check that Node.js is installed (`node --version`). If it is missing:
   - Tell the user Node.js is required and not currently installed.
   - Ask for approval before installing it.
   - If approved, install Node.js (e.g. via the system package manager or
     https://nodejs.org) and continue.
   - If not approved, stop executing this skill and tell the user Node.js is
     not installed so the skill cannot run.

1. Ask the user whether they want only the given ticket fetched, or the full
   related/child work-item hierarchy traversed. Use their answer to decide
   whether to pass `--no-traverse`.

   The given ticket is always returned in full regardless of its type. A leaf
   (Story, Spike, Bug) has nothing to traverse, so fetch it directly (step 4 /
   `--no-traverse`). A ticket that is neither a leaf nor a container (e.g. Task
   or Sub-task) is returned on its own — no parent, links, or children are
   fetched. Only when the root is a leaf or a container is its parent pulled in
   as extended context (marked with `notes: "Details for contextual purpose"`).

   A ticket URL must belong to the configured `JIRA_BASE_URL` site; a URL from a
   different host is rejected. Bare keys are accepted case-insensitively.

   All commands below must run from this skill folder, so `cd` into it first
   (the `node scripts/cli.mjs` path is relative to it) and pass `--out` by
   default so full JSON is written to the git-ignored `.cache/` folder rather
   than overflowing the terminal.

   > **Path note (read before running).** The `cd` target below,
   > `<skill-dir>`, is a placeholder — replace it with the **absolute path to
   > the folder that contains this `SKILL.md`** (i.e. the file's path with the
   > trailing `/SKILL.md` removed). Do **not** use a path relative to the
   > terminal's current directory: the terminal may start anywhere (workspace
   > root, a sibling folder, or elsewhere), so a relative `.github/skills/...`
   > path can fail with `cd: No such file or directory`. Derive `<skill-dir>`
   > from this file's known absolute path and use that exact value in every
   > command below.

2. If the user wants the hierarchy, get the index first (cheap, compact):

   ```bash
   cd "<skill-dir>" && node scripts/cli.mjs "<jira-ticket-url-or-key>" --out
   ```

   Returns a `hierarchy-index`: the bounded tree with keys, types, one-line
   summaries, statuses, relations, and counts. Only the given ticket, container
   types (Epic/Initiative), and leaf types (Story, Spike, Bug) are included —
   Tasks, Sub-tasks, and any other type are never fetched or listed.

   If the user only wants the given ticket, add `--no-traverse` (returns a full
   `work-item` for that ticket only):

   ```bash
   cd "<skill-dir>" && node scripts/cli.mjs "<jira-ticket-url-or-key>" --out --no-traverse
   ```

3. Then pull full detail for **every** ticket the index listed, in one call:

   ```bash
   cd "<skill-dir>" && node scripts/cli.mjs details "<jira-ticket-url-or-key>" --out
   ```

   Returns a `work-item-set`: the complete `work-item` for each item in the
   hierarchy (same filtering as the index), so you get full context on the whole
   epic/story set — not just the parent. Add `--no-traverse` to get the set for
   the given ticket only.

   With `--out` the full JSON is written to a file and only a compact summary
   (with `outputFile`) is printed; read that file instead of stdout. `--out`
   alone writes to the skill's git-ignored `.cache/` folder (inside the
   workspace, one file per root, overwritten on re-run); `--out <path>` writes to
   a path you choose. After you have read the file, delete it so ticket content
   is not left on disk.

4. To pull full detail for a single ticket on its own, use:
   ```bash
   cd "<skill-dir>" && node scripts/cli.mjs item "<ticket-key>" --out
   ```
   Returns a full `work-item`. Attachments are described but not downloaded;
   design URLs are reference strings only.

Each work item carries `error` and `notes`: `notes` flags contextual items (e.g.
a parent pulled in as context), and `error` / an `{ ticketKey, error }` stub
signals a ticket that could not be fetched. Always surface a non-empty
`truncated` flag or `warnings`/`error` entries to the user so partial or
excluded results are visible.

Errors are printed to stderr as `{ "error": "...", "code": "..." }` (redacted).

## Output and controls

Output conforms to [references/output-schema.json](references/output-schema.json).
For the exact requested fields, the identity fields that are never requested, and
how PII is stripped, see [references/security-and-fields.md](references/security-and-fields.md).
