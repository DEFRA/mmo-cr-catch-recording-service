# Output contract, requested fields, and PII controls

## Contents

- Requested Jira fields (data minimisation)
- Fields and endpoints never requested
- How PII is stripped
- Traversal bounds
- Output shapes (index and work-item)

## Requested Jira fields (data minimisation)

The client requests only these issue fields at source:

`summary, description, issuetype, status, priority, parent, subtasks, issuelinks, attachment, labels, updated`

## Never requested

Identity-bearing fields and endpoints are never requested: `assignee`, `reporter`,
`creator`, `comment`, `worklog`, `watches`/watchers, `votes`/voters, `changelog`.

## How PII is stripped (deterministic, non-AI)

- Allowlist mapping: only the fields above are mapped; anything else is dropped.
- ADF reduction: `@mention` nodes become `@[redacted]`; node `attrs` are never emitted.
- URL policy: query and fragment are removed from every URL (kills `accountId=` etc.).
- Attachment descriptors carry no author; filenames are path-normalised.
- PII guard: the final record is scanned for identity keys / email / `accountId`;
  if any survive, the record is rejected (fail closed).
- Shape guard: only the closed set of output keys is permitted.

## Input and egress boundary

- A provided ticket **URL** must resolve to the configured `JIRA_BASE_URL` host;
  a URL from any other host is rejected before a request is made. Bare keys are
  accepted case-insensitively and normalised to upper case.
- Network egress stays locked to the Jira site host. Any other URL that appears
  inside a ticket (design links etc.) is returned as a reference string only and
  is never fetched — an accepted risk on the assumption the ticket is credible.

## Traversal bounds

Traversal is bounded by `maxDepth`/`maxIssues` (see `config.mjs`) and, independently,
by issue type. Each issue is classified from its `issuetype.hierarchyLevel`
(`1`+ = Epic/Initiative container, `0` = standard Story/Task/Bug level, `-1` =
Sub-task) with a name-based fallback (`JIRA_LEAF_TICKET_TYPES`,
`JIRA_CONTAINER_TICKET_TYPES`):

- **Container** types (Epic, Initiative) are traversed through and collected.
- **Leaf** types (Story, Spike, Bug) are collected but never expanded.
- **Everything else** (Task, Sub-task, and any other type) is neither fetched
  nor emitted; each exclusion is recorded in `warnings`.

Only containers are expanded, so sub-tasks and the children of Tasks are never
pulled. The given (root) ticket is always collected in full regardless of its
type. Its parent is pulled in as extended context **only when the root is a leaf
or a container** (and is flagged with `notes: "Details for contextual purpose"`);
a root that is neither (e.g. Task or Sub-task) is returned on its own with no
parent, links, or children fetched. Leaf work items always report an **empty**
`children` array (the key is never omitted, just never populated), since their
only children are sub-tasks, which this skill never surfaces. The links of
expanded items are context only (collected if they are a leaf/container type,
never expanded).

## Output shapes

All conform to `output-schema.json`.

**hierarchy-index** (default command): `{ schemaVersion, kind:'hierarchy-index', root,
retrievedAt, count, truncated, warnings, index:[{ key, ticketType, summary, status,
depth, relation, notes, parentKey, linkKeys, attachmentCount, designUrlCount }] }`
— if the root itself could not be fetched, `index` instead holds a single
`{ key, error }` stub rather than an empty list.

**work-item** (`item` command): `{ schemaVersion, kind:'work-item', ticketKey,
ticketType, summary, description, acceptanceCriteria, status, priority, parent,
children, links, attachments, designUrls, labels, sourceJiraUrl, provenance,
truncated, sanitisationWarnings, error, notes }`

Every work item carries `error` (a per-item failure message, else null) and
`notes` (agent-facing annotation, e.g. `"Details for contextual purpose"` on a
parent pulled in as context, else null).

**work-item-set** (`details` command): `{ schemaVersion, kind:'work-item-set', root,
retrievedAt, count, truncated, warnings, items:[ work-item | { ticketKey, error }, ... ] }`
— the full `work-item` for every ticket the index would list, so the agent gets
complete detail across the whole hierarchy in one call. If the root cannot be
fetched, `items` (and the index) carry a single `{ ticketKey, error }` stub
instead of being empty.

Acceptance criteria are extracted deterministically from an "Acceptance Criteria"
heading inside the description; the full description is always returned as well.
