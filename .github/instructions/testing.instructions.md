---
description: 'Testing standards for the MMO Catch Recording Catch Recording Service: Vitest unit tests, Hapi server.inject route/API tests asserting JSON and error shapes, vitest-mongodb repository tests, vitest-fetch-mock for outbound calls, negative paths, coverage targets and SonarCloud. Use when writing or reviewing tests or setting quality gates.'
applyTo: '**/*.test.js'
---

# Testing standards

Follow DEFRA [quality assurance and test standards](https://defra.github.io/software-development-standards/standards/quality_assurance_standards/).
New or changed behaviour ships with tests. Track coverage in
[DEFRA SonarCloud](https://sonarcloud.io/organizations/defra) and keep the quality gate green.

Adopt the **testing pyramid**: catch most defects cheaply at the unit and API level.

## What to test

- **Unit tests** for services, helpers, config formats and domain rules. Fast, isolated, deterministic.
  Mock Mongo and outbound HTTP — no real network.
- **Route / API tests** using Hapi's `server.inject` against a server from `createServer()`. Assert the
  **status code**, the **JSON body** and, for failures, the **error shape** (`statusCode`, `error`,
  `message`) — the contract consumers depend on.
- **Validation tests** — for every Joi schema, prove a bad `params`/`query`/`payload` returns **400** and
  that `abortEarly: false` surfaces all errors, not just the first.
- **Repository / persistence tests** with `vitest-mongodb` against a real in-memory MongoDB, covering
  filters, projections, sorting, pagination and the not-found path.
- **Failure paths** — 400, 401, 403, 404, 409 and 500 are first-class tests, not an afterthought.
  Negative scenarios matter as much as positive ones: if "an admin can do X", prove "a standard user
  cannot".
- **Health** — `/health` returns 200 quickly and does not depend on a database.

## Framework & conventions

- **Vitest** is the test runner (`globals: true`, `environment: node`) with `@vitest/coverage-v8`. Colocate
  tests next to source as `*.test.js` (e.g. `example.test.js`), mirroring the existing helpers.
- Structure tests **Arrange → Act → Assert**. One behaviour per test; name by scenario and expected
  behaviour (`Should return 404 when the example id does not exist`) so the suite reads as documentation.
- Make tests independent and order-agnostic; `clearMocks` is on. Reset shared state. Use a fixed timezone
  (`TZ=UTC`, as the `test` script sets) and fake timers instead of real waits — never `sleep`.
- Use `vitest-fetch-mock` or explicit mocks for outbound calls; keep sample payloads/fixtures inline.
- Start/stop the Hapi server in `beforeAll`/`afterAll` (`server.initialize()` / `server.stop({ timeout: 0 })`).

## Coverage targets

Coverage must be **visible and reported** in [DEFRA SonarCloud](https://sonarcloud.io/organizations/defra)
and must not regress below the established baseline. The project quality gate is:

- **≥90%** overall (global) line/branch coverage.
- **≥95%** for core business logic — services, domain rules, helpers and config formats.
- **100%** for error-handling and security-critical paths — input validation, authentication,
  authorisation and error mapping.

**Coverage is a floor, not a goal.** Do not chase a percentage: a test written only to raise a number
proves nothing and has to be maintained forever. Reject tests that restate the framework or the driver,
near-duplicate cases that exercise the same path with trivially different data, and brittle tests coupled
to implementation detail. Assert on **observable behaviour and output**, not on internal calls.

Write tests alongside the code (same change, not a follow-up), and run the full suite after every change —
`npm test` — confirming all tests pass before moving on. Never weaken or delete an assertion to make a
failing test pass; a red test is usually reporting a real regression.

## Running

- Local/CI: `npm test` (runs `vitest run --coverage` with `TZ=UTC`). Watch mode: `npm run test:watch`.
- Every PR runs test + lint + format check + `npm run security-audit` + SonarCloud before merge
  (`npm run git:pre-commit-hook` runs the same gate locally).

See the [unit-tests skill](../skills/unit-tests/SKILL.md) for a step-by-step approach to writing Vitest
tests for this codebase.
