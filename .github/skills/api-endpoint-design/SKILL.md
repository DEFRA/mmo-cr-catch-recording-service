---
name: api-endpoint-design
description: 'Build or extend a JSON API endpoint end-to-end in the MMO Catch Recording Catch Recording Service: route module, Joi validation schema, thin handler, service and MongoDB data access, Boom error mapping, registration in the router, tests and API documentation. Use when adding a new route, changing an existing request/response shape, designing status codes or error shapes, or working from an API contract, OpenAPI snippet or acceptance criteria.'
argument-hint: "e.g. 'add GET /users/{userId}' or 'add pagination to the example list endpoint'"
user-invocable: false
---

# API endpoint design (Hapi + Joi + Boom)

Build an endpoint the way this service already does it, so the contract stays consistent and safe. Follow
the [nodejs-hapi-api](../../instructions/nodejs-hapi-api.instructions.md),
[security](../../instructions/security.instructions.md) and
[data-persistence](../../instructions/data-persistence.instructions.md) instructions.

## When to use

- Adding a new route, or a new resource with several routes.
- Changing a request or response shape, status code, or error shape on an existing route.
- Designing pagination, filtering or sorting for a collection endpoint.
- Turning an API contract, OpenAPI snippet or acceptance criteria into working code.

## Design the contract first

Before writing code, settle and write down:

1. **Resource and path** — plural, lower-kebab nouns (`/users`, `/users/{userId}`). No verbs in the path.
   No trailing slash (`stripTrailingSlash` is on).
2. **Method and semantics** — `GET` safe and idempotent; `POST` creates (201, plus a location where it
   applies); `PUT`/`PATCH` update; `DELETE` removes (204 when there is no body).
3. **Request shape** — every `params`, `query`, `payload` and `headers` field, with type, format, length,
   range and whether it is required.
4. **Response shape** — the exact JSON, field by field. Decide what is deliberately **not** returned
   (internal ids, PII, anything the caller does not need).
5. **Status codes** — the success code plus every failure: 400 (validation), 401/403 (authN/authZ), 404
   (not found), 409 (conflict/duplicate), 500 (unexpected).
6. **Pagination and bounds** — a collection endpoint always has a `limit` (with a maximum) and a
   deterministic sort.
7. **Compatibility** — is any of this a change to a **published** contract? If so it is a breaking change:
   version it, keep the old behaviour while consumers depend on it, and record it.

## Build it

### 1. Route module — `src/routes/<name>.js`

Export a route object, or an array of them for a resource. Give each route `method`, `path`,
`options.validate` and a thin `handler`.

```js
import Boom from '@hapi/boom'
import Joi from 'joi'
import { findExampleData } from '#/services/ExampleFind.js'

export const example = [
  {
    method: 'GET',
    path: '/example/{exampleId}',
    options: {
      validate: {
        params: Joi.object({
          exampleId: Joi.string().guid().required()
        })
      }
    },
    handler: async (request, h) => {
      const entity = await findExampleData(request.db, request.params.exampleId)

      if (!entity) {
        return Boom.notFound()
      }

      return h.response(entity)
    }
  }
]
```

### 2. Validation schema

- Cover **every** input the route accepts. Use strict allow-lists — type, format, length, range, enum — and
  reject unknown keys rather than letting them through.
- Bound array and string lengths so a caller cannot force unbounded work.
- Keep the server default `abortEarly: false` so all errors surface through the shared `failAction`.
- Never accept a free-form object that will be used as a query filter.

### 3. Handler (thin)

Validate (via the schema), call a **service**, shape the response. No domain rules, no database calls, no
outbound HTTP in the handler.

### 4. Service — `src/services/<Name>.js`

- Takes `db` as its first argument and stays framework-agnostic — no `request`, no `h`, no Boom.
- Builds the Mongo filter from **validated scalars only**. Never pass a caller-supplied object into a
  filter, update or aggregation.
- Projects explicitly, bounds every multi-document read, and returns plain data.

### 5. Errors

Map failures to `@hapi/boom` in the handler: `Boom.badRequest()`, `Boom.unauthorized()`, `Boom.forbidden()`,
`Boom.notFound()`, `Boom.conflict()` (duplicate key). Log the detail with `request.logger`; return nothing
internal — no stack trace, driver error or connection string.

### 6. Register it

Add the route module to `src/plugins/router.js`:

```js
server.route([health].concat(example, users))
```

### 7. Authorisation

Every non-public route enforces authorisation, checked against **the resource being acted on**, not just
the caller's identity. `/health` is the only route that stays unauthenticated — and it must stay fast and
free of database round-trips.

### 8. Indexes

Any field the new query filters or sorts on needs an index, created idempotently at startup. A unique
domain constraint gets a `unique` index, and its duplicate-key error maps to `Boom.conflict()`.

### 9. Tests

Follow the [unit-tests skill](../unit-tests/SKILL.md). At minimum:

- `server.inject` happy path — status code and exact JSON body.
- Validation failure — 400 with all errors surfaced and nothing internal in the message.
- Not-found / unauthorised / forbidden / conflict, as applicable.
- Service-level tests with a mocked `db`, plus a `vitest-mongodb` repository test for the real query.

### 10. Document it

Update the README API section (and `docs/api-reference.md` where one exists) in the **same change**: path,
method, parameters, request/response examples and every error status.

## Verify against the running service

`npm run dev`, then exercise the route with `curl`: happy path, a deliberately invalid request (expect 400
with all errors), the not-found/unauthorised path, and `/health`. Check the logs carry the diagnostic detail
and **no PII, tokens or secrets**.

## Checklist

- [ ] Path, method and status codes follow HTTP semantics
- [ ] Every input validated with Joi; unknown keys rejected; lengths/ranges bounded
- [ ] Handler is thin; domain and IO logic live in a service
- [ ] Mongo filter built from validated scalars; read projected, bounded and index-backed
- [ ] Authorisation enforced (unless it is `/health`)
- [ ] Errors returned as Boom with a stable shape; nothing internal leaked
- [ ] Route registered in `src/plugins/router.js`
- [ ] Tests cover the happy path and every failure path
- [ ] README / API docs updated in the same change
- [ ] Any change to a published contract is versioned and recorded as breaking
