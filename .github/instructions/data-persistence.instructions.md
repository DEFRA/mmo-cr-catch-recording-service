---
description: 'MongoDB data-access standards for the MMO Catch Recording Catch Recording Service: the mongoDb plugin and request.db, injection-safe filters, projections and bounded queries, index design, mongo-locks for mutual exclusion, transactions and vitest-mongodb test patterns. Use when reading or writing data, designing collections or indexes, or reviewing persistence code.'
applyTo: 'src/**/*.js'
---

# Data persistence (MongoDB)

Precedence: DEFRA standards > community MongoDB guidance. Persistence is where correctness, performance and
injection risk meet — treat it as a security surface.

## Connection & access

- MongoDB is registered once as the `mongoDb` plugin (`src/plugins/mongodb.js`) from `config.get('mongo')`.
  It exposes the database as **`request.db`** and `server.db`, and a `mongo-locks` `LockManager` as
  `server.locker`. **Never create a second `MongoClient`** — reuse the pooled connection.
- Configuration (`mongoUrl`, `databaseName`, `retryWrites`, `readPreference`) comes from `src/config.js`.
  The URI is a secret and arrives from the environment; never hard-code or log it.
- The connection is closed on server stop via `hapi-pulse` — do not add ad-hoc teardown.

## Layering

- **Handlers never touch the database.** A route handler calls a service; the service receives `db` as an
  argument and stays framework-agnostic (see `src/services/ExampleFind.js`).
- Keep one module per aggregate/collection so queries are easy to find, review and test.
- Services return plain data, not driver cursors — call `.toArray()` (bounded) inside the service.

## Writing safe queries

- **Never pass a caller-supplied object into a filter, update or aggregation.** Build the filter yourself
  from Joi-validated scalars, so a payload like `{ "id": { "$gt": "" } }` cannot become an operator.
- Reject or strip keys beginning with `$` or containing `.` before they reach a query.
- Use `$set` with an explicit allow-list of fields on update — never spread an untrusted payload into a
  document.
- Never build a query from string concatenation, and never pass untrusted input to `$where` or
  `mapReduce`.

## Query design

- **Always project.** Return only the fields the caller needs (`{ projection: { _id: 0, … } }`) — this is
  both a performance and a data-minimisation control.
- **Always bound.** Every multi-document read has a `limit` (and a deterministic `sort` when paginated).
  Never return an unbounded collection.
- Paginate with a stable sort key; prefer range/keyset pagination over large `skip` values.
- Put an explicit timeout on long operations (`maxTimeMS`) so a slow query cannot hang a request.

## Indexes

- Every query a route depends on must be **index-backed**. Create indexes at startup (idempotently, via
  `createIndex`/`createIndexes` in the plugin or a bootstrap helper) so every environment matches.
- Design compound indexes to the equality → sort → range order of the query that uses them.
- Add a `unique` index for any field the domain treats as unique, and handle the resulting duplicate-key
  error as a `Boom.conflict()`.
- Don't add speculative indexes — each one costs write throughput and storage.

## Documents & identifiers

- Use a **domain identifier** (e.g. `exampleId`) in the API surface and keep `_id` internal; project `_id`
  out of responses.
- Validate and convert any `ObjectId` explicitly (`ObjectId.isValid()` before `new ObjectId()`), and return
  `Boom.badRequest()` — not a 500 — on a malformed id.
- **Never use PII as a key, index value or collection name.** Store the minimum personal data needed, and
  apply the same PII rules as logging (see [security instructions](security.instructions.md)).
- Timestamps are stored as `Date`, in UTC.

## Concurrency & consistency

- Use `mongo-locks` via `server.locker` and the helpers in `src/common/helpers/mongo-lock.js` for mutual
  exclusion: `acquireLock` when a missed lock is tolerable, `requireLock` when it is not. **Always release
  the lock in a `finally` block.**
- Prefer a single atomic operation (`findOneAndUpdate`, `updateOne` with a guard in the filter) over
  read-modify-write. Where a multi-document invariant genuinely needs it, use a transaction on a replica
  set and keep it short.
- Make write operations idempotent where a caller may retry (`retryWrites` is configurable).

## Errors

- Map driver failures to `@hapi/boom`: duplicate key → `Boom.conflict()`, not found → `Boom.notFound()`,
  malformed input → `Boom.badRequest()`, anything unexpected → a logged 500 with no internal detail.
- **Never let a driver error, connection string or query reach the caller.**

## Testing

- Use **`vitest-mongodb`** for repository tests against a real in-memory MongoDB: seed the collection,
  exercise the service, assert the returned data.
- Cover the not-found path, the projection (assert `_id` is absent), the bound/limit, sorting and the
  duplicate-key/conflict path.
- Reset collection state between tests so they stay order-agnostic. Unit-test everything above the service
  layer with a mocked `db`.
