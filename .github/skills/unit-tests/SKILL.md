---
name: unit-tests
description: 'Write and strengthen Vitest tests for the MMO Catch Recording Catch Recording Service: unit tests for services, helpers and config formats, Hapi server.inject route/API tests asserting status, JSON body and error shape, and vitest-mongodb repository tests. Use when adding tests for new/changed behaviour, closing coverage gaps, or setting up a test for a new route. Enforces the tiered coverage targets and DEFRA SonarCloud gate.'
argument-hint: "e.g. 'write tests for the example route' or 'close the coverage gap in validate-mongo-uri'"
user-invocable: false
---

# Unit & route tests (Vitest)

Write fast, deterministic tests that ship **with** the code, following the
[testing instructions](../../instructions/testing.instructions.md). New or changed behaviour is not done
until it has tests and the suite is green.

## When to use

- Adding tests for a new/changed route, service, helper or config format.
- Adding a route/integration test for a new endpoint.
- Adding a repository test for a new query or collection.
- Closing a coverage gap flagged by SonarCloud or the coverage report.

## What to test (by layer)

- **Routes (API)** — via `server.inject` against `createServer()`. Assert the **status code**, the **JSON
  body** and, for failures, the **error shape** (`statusCode`, `error`, `message`). This is the contract
  consumers depend on.
- **Validation** — for every Joi schema, a bad `params`/`query`/`payload`/`headers` returns **400** and
  `abortEarly: false` surfaces **all** errors, not just the first. Assert the message leaks nothing
  internal.
- **Services / domain logic** — inputs → outputs and error paths, in isolation with a mocked `db` and
  mocked outbound HTTP.
- **Repositories / persistence** — with `vitest-mongodb` against a real in-memory MongoDB: filters,
  projections (assert `_id` is absent), sorting, pagination limits, not-found and duplicate-key paths.
- **Plugins & helpers** — `failAction`, `mongo-lock`, logger options, convict formats.
- **Failure paths** — 400, 401, 403, 404, 409 and the unexpected-500 path. These are **100%**-coverage
  paths.
- **Health** — `/health` returns 200 quickly and touches no database.

## Procedure

1. **Read** the code under test and the existing colocated `*.test.js` nearby for the established pattern
   (see `src/common/helpers/fail-action.test.js` and `src/plugins/mongodb.test.js`).
2. **Arrange** — build the server in `beforeAll` (`server.initialize()`), tear down in `afterAll`
   (`server.stop({ timeout: 0 })`). Mock outbound HTTP (`vitest-fetch-mock`/explicit mocks); use
   `vitest-mongodb` where a real database is needed; keep fixtures inline. Rely on `clearMocks` and a fixed
   `TZ=UTC`.
3. **Act** — call the function directly, or `server.inject({ method, url, payload, headers })` for a route.
4. **Assert** — one behaviour per test; assert **observable output** (status, body, error shape, stored
   document), not internal calls. Parse with `JSON.parse(result)` or use `response.result`.
5. **Name** tests to describe the scenario and expected behaviour (`Should return 400 when exampleId is not
a GUID`) so the suite reads as documentation for non-technical colleagues.
6. **Cover the negative case.** If "an authorised caller can read X", prove "an unauthorised caller cannot".
   Keep tests independent and order-agnostic; no real timers/`sleep` — use fake timers.
7. **Run & verify** — `npm test` (with coverage). Confirm all pass and coverage meets the targets before
   finishing.

## Coverage targets (must hold)

- **≥90%** global · **≥95%** core logic (services, domain rules, helpers, config formats) · **100%**
  error-handling and security-critical paths (validation, authentication, authorisation, error mapping).
- Coverage must be **reported** and must not regress below the DEFRA
  [SonarCloud](https://sonarcloud.io/organizations/defra) baseline; the quality gate stays green.
- **Coverage is a floor, not a goal.** A test written only to move the number proves nothing and costs
  maintenance forever.

## Anti-patterns to avoid

- Hitting a real network, a real database or an external service.
- Passing an unvalidated object into a test query and asserting it "works" — that hides an injection bug.
- Time/locale flakiness — always pin `TZ` and use fake timers, never `sleep`.
- Asserting internal calls instead of observable behaviour/output.
- Tests that restate the framework or the driver (e.g. proving Joi rejects a number).
- Near-duplicate cases that exercise the same path with trivially different data.
- Brittle whole-body snapshots — assert the specific fields that matter.
- **Weakening or deleting an assertion to make a failing test pass.** A red test is usually a real
  regression; understand it before changing it.
- Leaving the suite red or skipping a failing test "to fix later".

## Output

- The added/updated `*.test.js` colocated with the source.
- A short note of what is covered (including which negative paths), any gaps intentionally left with
  rationale, and the pass/coverage result from `npm test`.
