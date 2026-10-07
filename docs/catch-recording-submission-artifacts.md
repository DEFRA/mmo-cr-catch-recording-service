## Catch Recording submission artifact listing and retrieval

> Produced by Phase 8, Step 35
> (`design/github-prompts/step-35-implement-submission-artifact-listing-and-retrieval.md`). Owned by
> `src/catch-recording/controller/list-submission-artifacts.js` and
> `retrieve-submission-artifact.js`. The underlying decisions are recorded in
> [`docs/configuration-decisions.md`](./configuration-decisions.md) → "Phase 8 decisions" → "Step 35".

## Endpoints

```http
GET /v1/catch-records/{catchRecordId}/submissions
GET /v1/catch-records/{catchRecordId}/submissions/{submissionNumber}/{artifactType}
```

`artifactType` is the public, URL-facing segment — `json` or `pdf` only (mapped explicitly to the
persisted `JSON_SNAPSHOT`/`PDF_RECEIPT` types via `artifact-keys.js`'s closed lookup; no case-folding or
alias behaviour).

## Listing response

```json
{
  "catchRecordId": "...",
  "count": 1,
  "submissions": [
    {
      "submissionNumber": 1,
      "artifacts": [
        {
          "type": "json",
          "contentType": "...",
          "contentLength": 123,
          "checksum": "..."
        },
        {
          "type": "pdf",
          "contentType": "...",
          "contentLength": 456,
          "checksum": "..."
        }
      ]
    }
  ]
}
```

Built entirely from the Catch Record's own trusted, persisted `artifacts[]` metadata — never calls
object storage. A submission is listed only when **both** approved artifact types are present for its
submission number (an internally inconsistent partial group — structurally impossible under normal
operation, since `applySubmission` always commits both entries in one atomic write — is excluded
defensively rather than surfaced as a false "available" submission). Ordered ascending by submission
number. Never returns an object key, bucket name, storage endpoint, artifact body, or complete Catch
Record data.

## Retrieval response

Buffered (not streamed — no evidence of large artifact sizes exists anywhere in the repository), with:

- `Content-Type`: the deterministic, server-computed content type for the requested artifact type
  (never trusted from the stored object's own metadata).
- `Content-Disposition: attachment; filename="..."` — a server-generated, deterministic filename built
  from the Catch Record's own `catchRecordReference` and submission number (`{reference}-submission-
{n}.{json|pdf}`), defensively stripped to a safe character set even though the reference is already
  server-generated from a known-safe alphabet.

## Safety

Before ever calling object storage, the requested `(submissionNumber, artifactType)` pair is checked
against the Catch Record's own trusted `artifacts[]` metadata. A submission number or artifact type that
was never committed returns `404` (`CATCH_ARTIFACT_NOT_FOUND`) **without calling `CatchArtifact`** — a
client can never probe object storage with an arbitrary, uncommitted combination. A storage key is always
recomputed deterministically from the three trusted inputs; neither endpoint ever accepts or constructs a
key from client input. Both endpoints reuse the existing owner-scoped read
(`findCatchRecordByIdForOwner`) for authorisation — a different owner (or a non-existent record) receives
the identical safe `404`, never a distinguishing `403`, preventing horizontal resource enumeration
(consistent with every other owner-scoped Catch Record endpoint).

## What Step 35 does not do

- Expose a generic artifact-browsing or document-management capability.
- Accept a storage key, bucket name, or content type from the client.
- List uncommitted, orphaned, or idempotency-in-progress artifacts.
