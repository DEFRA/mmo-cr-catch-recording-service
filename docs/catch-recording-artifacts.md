# Catch Recording immutable submission artifacts

> Produced by Phase 8, Step 33
> (`design/github-prompts/step-33-implement-immutable-json-and-pdf-artifact-capabilities.md`). Owned by
> `src/catch-recording/artifact/` (`CatchArtifact`) and `src/catch-recording/pdf/` (`PDFGenerator`). The
> underlying decisions are recorded in [`docs/configuration-decisions.md`](./configuration-decisions.md)
> → "Phase 8 decisions (Steps 32-38)".

## Purpose

Every successful submission or resubmission (Steps 34/38) must produce one immutable canonical JSON
snapshot and one PDF receipt generated from that same snapshot, stored under deterministic,
server-generated keys that can never be overwritten once committed. This module implements that
capability only — it never submits a Catch Record itself.

## Module boundary

| File                                  | Responsibility                                                                                                                                                        |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `artifact/artifact-keys.js`           | Deterministic key generation, the two approved artifact types, content types, public↔persisted type mapping — no AWS SDK, no network                                  |
| `artifact/artifact-errors.js`         | `ApplicationError` builders reusing the existing `ARTIFACT_OPERATION_FAILURE`/`RESOURCE_NOT_FOUND` categories                                                         |
| `artifact/catch-artifact.js`          | `CatchArtifact`, the framework-neutral port: `storeSubmissionArtifacts`/`retrieveCommittedArtifact` — depends only on an injected `store`, never the AWS SDK directly |
| `artifact/s3-artifact-store.js`       | The only file that imports `@aws-sdk/client-s3` — the S3-compatible storage adapter                                                                                   |
| `controller/catch-artifact-plugin.js` | Registers the production adapter once, decorates `request.catchArtifactStore` (mirrors the `mongoDb`/`reference-data` plugin pattern)                                 |
| `pdf/pdf-generator.js`                | `PDFGenerator`: `generateSubmissionReceiptPdf(snapshot)` — pdfkit-based, immutable-snapshot input only                                                                |

`CatchArtifact` never imports the AWS SDK, Hapi, Boom, Joi, or MongoDB directly
(`architecture-boundary.test.js` enforces this) — only the adapter does.

## Deterministic artifact keys

```text
catch-records/{catchRecordId}/submissions/{submissionNumber}/snapshot.json
catch-records/{catchRecordId}/submissions/{submissionNumber}/receipt.pdf
```

Always server-generated from a trusted, already-validated `(catchRecordId, submissionNumber, type)`
triple — never accepted from a client, never random per write. `catchRecordId` must match the exact
lower-case UUID shape this service always generates; `submissionNumber` must be a safe positive integer
within a generous bound. Both guards reject path-traversal and object-key-injection attempts before any
storage call is made.

## Immutability mechanism (approved local-development substitute)

Neither the local `floci` emulator nor every S3-compatible target is guaranteed to support conditional
("create-only") writes. Immutability is enforced instead by:

1. A pre-write `HeadObject` existence check.
2. A byte-identical pre-existing object (same stored SHA-256 checksum) is treated as a safe, idempotent
   reuse — this is what makes Step 34's deterministic submission recovery safe to retry.
3. A mismatching pre-existing object is rejected with `ARTIFACT_INTEGRITY_CONFLICT` rather than being
   overwritten.
4. After every write, a `HeadObject` re-read verifies the object exists with the expected content length
   before the write is considered successful.

This is an approved, explicitly-documented local-development/early-production substitute — it is **not**
claimed as true distributed-transaction safety or S3 object-lock-grade immutability. If fault-injection
evidence later shows this is insufficient, a stronger mechanism (bucket versioning, object lock, or
conditional writes on a target that supports them) can be introduced without changing any other module's
contract.

## Artifact integrity metadata

A SHA-256 hex checksum (Node's built-in `crypto`, the same primitive already used by
`idempotency-fingerprint.js`) plus content type and content length are computed at write time, stored as
S3 object metadata, and re-verified on every retrieval. The artifact body itself is never embedded in the
Catch Record — only `{ submissionNumber, type, contentType, contentLength, checksum }` is ever persisted
as `artifacts[]` metadata (the existing `ArtifactMetadata` contract already forbids embedding a body).

## Configuration

| Key                                  | Env                                      | Default     | Purpose                                             |
| ------------------------------------ | ---------------------------------------- | ----------- | --------------------------------------------------- |
| `catchArtifacts.bucketName`          | `CATCH_ARTIFACTS_BUCKET`                 | `null`      | S3-compatible bucket name                           |
| `catchArtifacts.region`              | `AWS_REGION`                             | `eu-west-2` | AWS region                                          |
| `catchArtifacts.endpoint`            | `AWS_ENDPOINT_URL`                       | `null`      | Optional endpoint override (e.g. local `floci`)     |
| `catchArtifacts.forcePathStyle`      | `CATCH_ARTIFACTS_FORCE_PATH_STYLE`       | `false`     | Path-style addressing, required by local emulators  |
| `catchArtifacts.maxPdfRenderedItems` | `CATCH_ARTIFACTS_MAX_PDF_RENDERED_ITEMS` | `200`       | Rendering-safety bound only — never a business rule |

No credential key exists — the AWS SDK's own default credential provider chain is used unchanged (local
env vars via `compose/aws.env`; an IAM task role in deployed CDP environments).

## PDF receipt content

Rendered from the immutable snapshot only (never mutable database state, never a Reference Data Service
call): submission reference/number/status/timestamp/actor, schema version, vessel, trip dates and ports,
pair-fishing detail (only when enabled), every gear (characteristics, statistical area, species caught
with weights), and species not landed. A pragmatic, configurable rendering-safety bound
(`maxPdfRenderedItems`) limits how many gear/species entries are rendered — approved as a safety control,
never a completeness rule.

## PDF accessibility (known limitation)

The document declares a language (`lang: 'en-GB'`) and descriptive `info.Title`/`info.Subject` metadata,
uses native vector text throughout (never a rasterised/image-only page, so the receipt stays selectable
and searchable), and renders every section in one fixed, logical top-to-bottom order. **Full tagged-PDF /
PDF-UA conformance (an explicit structure tree) is not implemented or claimed** — no approved accessibility
conformance target exists anywhere in the repository, and `pdfkit`'s tagged-PDF support would need a
deliberately-built structure tree to be genuinely conformant; claiming `tagged: true` without one would be
worse than not claiming it. This is a recorded, explicit limitation, not an oversight.

## Artifact retention

No retention duration, legal-hold requirement, or deletion/archival behaviour is approved anywhere in the
repository. None is implemented — committed artifacts are retained indefinitely by default S3 bucket
behaviour, and no deletion or lifecycle-management code exists in this service.

## What Step 33 does not do

- Submit, resubmit, or transition a Catch Record's lifecycle.
- Expose an HTTP route (Steps 34/35 do).
- List or retrieve artifact metadata from the Catch Record (Step 35's `CatchQuery` responsibility).
- Implement a generic document-management or caching capability.
