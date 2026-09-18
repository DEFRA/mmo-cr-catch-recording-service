# Output contract, requested fields, and PII controls

## Contents

- Requested Confluence data (data minimisation)
- Data and endpoints never requested
- How PII is stripped
- Input and egress boundary
- Output shape

## Requested Confluence data (data minimisation)

The client makes only these read-only calls for the single requested page:

- `GET /wiki/api/v2/pages/{id}?body-format=atlas_doc_format&include-labels=true`
  — the page body as **ADF** (Atlas Document Format) plus its labels, title,
  status, `spaceId` and `parentId`.
- `GET /wiki/api/v2/pages/{id}/attachments` — attachment **descriptors** only
  (id, title, media type, size). Skipped entirely with `--no-attachments`.
  No `include-versions`, `include-likes`, `include-operations` or any other
  identity-bearing expansion is ever requested.

## Never requested / never emitted

Identity-bearing fields are never surfaced: `authorId`, `ownerId`,
`lastOwnerId`, `version.authorId`, `likes`/`accountId`, page history, comments,
and any display name, email or avatar. Only the single requested page is
fetched — **child, related and linked pages are never fetched or traversed.**

## How PII is stripped (deterministic, non-AI)

- **Allowlist mapping:** only the fields listed above are mapped onto a closed
  output shape; anything else in the raw response is dropped.
- **ADF reduction:** the body is reduced to plain-text/markdown. `@mention`
  nodes become `@[redacted]`; node `attrs` are never emitted.
- **Email redaction in body text:** any email address typed into the body (not
  an ADF mention) is replaced with `[redacted-email]`.
- **Telephone number redaction:** UK and international-format telephone numbers
  typed into the body (e.g. `+44 7...`, `07... ...`, `0800 ...`) are replaced
  with `[redacted-phone]`, wherever they appear — table cells or prose.
- **Table Name-column redaction:** in any table, plain text typed directly into
  a cell under a column headed "Name"/"Names" (case-insensitive, matched from
  the first row of the table regardless of cell type) is replaced with
  `[redacted-name]`. This catches names typed as plain text, which — unlike an
  `@mention` — the ADF reducer would otherwise pass through unchanged.
- **URL policy:** query and fragment are removed from every URL (kills
  `accountId=` and tracking params). URLs that appear in the page body are left
  inline in the text as-is (after that stripping); they are never fetched.
- **Attachment descriptors** carry no author/version identity; filenames are
  path-normalised.
- **PII guard:** the final record is scanned for identity keys / email /
  `accountId`; if any survive, the whole record is rejected (fail closed).
- **Shape guard:** only the closed set of output keys is permitted.

## Input and egress boundary

- A provided page **URL** must resolve to the configured `CONFLUENCE_BASE_URL`
  host; a URL from any other host is rejected before a request is made. A bare
  numeric **page id** is also accepted. The id is extracted from `…/pages/<id>/…`
  or a `?pageId=<id>` query. Short `"/wiki/x/<token>"` tiny links are **not**
  supported (they would require following a redirect) — pass the full page URL
  or the numeric id.
- Network egress stays locked to the Confluence site host. Any other URL that
  appears inside the page is left inline in the body text and is never fetched.

## Output shape

Conforms to `output-schema.json`.

**confluence-page:** `{ schemaVersion, kind:'confluence-page', pageId, title,
status, spaceId, parentId, body, labels, attachments, sourceConfluenceUrl,
provenance, truncated, sanitisationWarnings, error, notes }`

If the page could not be fetched, a compact `{ schemaVersion, kind, pageId,
error }` stub is returned instead. Always check `truncated` (e.g. attachment cap
reached) and `sanitisationWarnings` for redactions or partial results.
