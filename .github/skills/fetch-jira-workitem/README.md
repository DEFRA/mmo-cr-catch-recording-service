# fetch-jira-workitem

A Node.js CLI + agent skill that fetches a Jira Cloud ticket (and, optionally, its
work-item hierarchy) and returns **sanitised, PII-free JSON** — no dependencies,
no server, read-only by design.

> For the agent-facing procedure (how Copilot should call this skill step by
> step), see [SKILL.md](SKILL.md). This README is the human-facing setup and
> usage reference.

## What it does

- Fetches a Jira issue by **URL or key** and returns summary, description,
  acceptance criteria, status, priority, labels, parent/child/linked-issue
  references, attachment _descriptors_ (not files) and design-URL references.
- Optionally **traverses the work-item hierarchy**: an Epic/Initiative is
  expanded to collect its Story/Spike/Bug children; a leaf ticket collects its
  parent as context. Tasks, Sub-tasks and any other type are excluded.
- **Strips all PII before the data ever reaches the agent**: no assignee,
  reporter, creator, comments, worklogs, watchers, votes, or changelog are ever
  requested or emitted. Every URL is stripped of query/fragment. A final guard
  scans the output and fails closed if any identity data survives.
- **Never mutates Jira** (no writes, transitions, comments) and **never
  downloads attachments or fetches design/Figma URLs** — those are returned as
  reference strings only, for a human to action.

See [references/security-and-fields.md](references/security-and-fields.md) for
the full data-minimisation and PII-stripping contract, and
[references/output-schema.json](references/output-schema.json) for the exact
JSON shape.

## Requirements

- Node.js **18+** (uses the built-in `fetch`; no `npm install` needed).
- A Jira Cloud API token.

## Setup

1. Copy [assets/.env.example](assets/.env.example) to `.env` in this folder.
2. Create an API token at
   https://id.atlassian.com/manage-profile/security/api-tokens — prefer a
   low-privilege account scoped to **Browse projects** only.
3. Fill in `.env`:

   | Variable                      | Required | Default           | Purpose                                                        |
   | ----------------------------- | :------: | ----------------- | -------------------------------------------------------------- |
   | `JIRA_BASE_URL`               |    ✅    | —                 | Your Jira Cloud site, e.g. `https://your-domain.atlassian.net` |
   | `JIRA_EMAIL`                  |    ✅    | —                 | Account email for Basic auth                                   |
   | `JIRA_API_TOKEN`              |    ✅    | —                 | API token for Basic auth                                       |
   | `JIRA_MAX_DEPTH`              |    —     | `5`               | Max traversal depth from the root ticket                       |
   | `JIRA_MAX_ISSUES`             |    —     | `100`             | Max issues collected in one run                                |
   | `JIRA_LEAF_TICKET_TYPES`      |    —     | `story,spike,bug` | Types collected but never expanded                             |
   | `JIRA_CONTAINER_TICKET_TYPES` |    —     | `epic,initiative` | Types traversed through to reach leaves                        |
   | `JIRA_DESIGN_HOST_ALLOWLIST`  |    —     | `figma.com`       | Hosts classified as design-URL references (never fetched)      |

`.env` is git-ignored and must **never** be committed, read back, or printed —
including by the agent, on any error.

## Usage

Run every command from this folder (paths in examples are relative to it):

```bash
# Hierarchy index for a ticket (or its Epic) — compact, cheap
node scripts/cli.mjs "<url-or-key>" --out

# Full detail for the given ticket only, no traversal
node scripts/cli.mjs "<url-or-key>" --no-traverse --out

# Full detail for every ticket in the hierarchy (Epic + all its Stories/Spikes/Bugs)
node scripts/cli.mjs details "<url-or-key>" --out

# Full detail for a single ticket only, on its own
node scripts/cli.mjs item "<ticket-key>" --out
```

| Flag            | Effect                                                                                                                       |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `--out`         | Write full JSON to the git-ignored `.cache/` folder; print a compact summary (with `outputFile`) instead of the full payload |
| `--out <path>`  | Write full JSON to a path you choose instead                                                                                 |
| `--no-traverse` | Don't expand containers — return only the given ticket                                                                       |

A ticket **URL** must belong to the configured `JIRA_BASE_URL` host (a URL from
another site is rejected before any request is made). Bare **keys** are
accepted case-insensitively.

### Output shapes

| Command                      | Returns           | Contents                                                           |
| ---------------------------- | ----------------- | ------------------------------------------------------------------ |
| `<url-or-key>`               | `hierarchy-index` | Bounded tree: keys, types, one-line summaries, statuses, relations |
| `<url-or-key> --no-traverse` | `work-item`       | Full sanitised detail for the one ticket                           |
| `details <url-or-key>`       | `work-item-set`   | Full sanitised detail for every item the index listed              |
| `item <ticket-key>`          | `work-item`       | Full sanitised detail for one ticket, standalone                   |

Every item carries `notes` (e.g. `"Details for contextual purpose"` for a
parent pulled in as context) and `error` (for a ticket that failed to fetch).
Always check `truncated` and `warnings`/`sanitisationWarnings` for partial or
excluded results.

## Errors

Printed to **stderr** as redacted JSON: `{ "error": "...", "code": "..." }`.
On an auth/credential error, check `.env` yourself — the agent will not (and
must not) read it for you.

## Boundaries (by design, not configurable)

- Read-only: no Jira write, transition, comment, or attachment upload is ever
  performed.
- Network egress is locked to the `JIRA_BASE_URL` host; no other URL is ever
  fetched (design links are extracted as text only).
- Identity fields are never requested from the Jira API, not just filtered
  after the fact.
- Every run is stateless — nothing is cached or reused between invocations
  beyond the `.cache/` output file, which the agent is expected to delete once
  it's done reading the result.
