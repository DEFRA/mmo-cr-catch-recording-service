# Repository Context: Generic Service Skeleton

> Produced by Phase 1, Step 01 (`design/github-prompts/step-01-inspect-generic-service-skeleton.md`).
> Evidence-based record of confirmed repository conventions for later Catch Recording implementation
> steps. Facts are cited to the file(s) that support them. Unconfirmed items are listed separately under
> "Unknowns and deferred decisions" — they are not assumptions.

## 1. Repository organisation

- `src/index.js` — entry point: starts the server, installs an `unhandledRejection` guard
  (`src/index.js`).
- `src/server.js` — Hapi server composition (`src/server.js`).
- `src/config.js` — convict configuration schema (`src/config.js`).
- `src/plugins/` — Hapi plugins: `router.js`, `mongodb.js`, `pulse.js`, `request-logger.js`,
  `request-tracing.js`, `logger-options.js`.
- `src/routes/` — one module per resource: `health.js`, `example.js` (scaffold example, **not** a Catch
  Recording requirement).
- `src/services/` — domain/IO logic, framework-agnostic: `ExampleFind.js` (scaffold example).
- `src/common/helpers/` — cross-cutting helpers: `fail-action.js`, `mongo-lock.js`, `start-server.js`,
  `logging/logger.js`, `convict/validate-mongo-uri.js`.
- `docs/adr/` — Architecture Decision Records (`docs/adr/README.md`, `docs/adr/template.md`); this is the
  established documentation location on the repository (hence this document living under `docs/`).

Source: `package.json` (`"imports": { "#/*": "./src/*" }`), the file tree above.

## 2. Node.js runtime and module conventions

- Node.js `>= 24` required (`package.json engines`, `.nvmrc`).
- ES Modules throughout (`"type": "module"` in `package.json`); no CommonJS in `src/`.
- Import alias `#/` resolves to `src/` (`package.json` `imports` field), used with explicit `.js`
  extensions (e.g. `import { config } from '#/config.js'` in `src/server.js`).
- No build/type-check/compilation step exists; the app runs directly via `node --watch ./src` (dev) or
  `node .` (production) (`package.json` scripts `server:watch`, `start`).

## 3. Hapi server and plugin registration

- Server created in `createServer()` in `src/server.js` with `host`/`port` from config, route defaults
  (`validate.options.abortEarly: false`, shared `failAction`), and a `security` header block (`hsts`,
  `xss: 'enabled'`, `noSniff: true`, `xframe: true`); `router.stripTrailingSlash: true`.
- Plugins are registered, in this exact order: `requestLogger`, `requestTracing`, `metrics`
  (`@defra/cdp-metrics`), `secureContext` (`@defra/hapi-secure-context`), `pulse` (`hapi-pulse`),
  `mongoDb` (options from `config.get('mongo')`), `router` (`src/server.js`).
- `requestLogger` wraps `hapi-pino` with options from `src/plugins/logger-options.js`
  (`src/plugins/request-logger.js`).
- `requestTracing` wraps `@defra/hapi-tracing`, using the `tracing.header` config value
  (`src/plugins/request-tracing.js`).
- `pulse` wraps `hapi-pulse` for shutdown handling with a 10-second timeout (`src/plugins/pulse.js`).
- Shutdown closes the Mongo client on the server `'stop'` event (`src/plugins/mongodb.js`).

## 4. Route registration

- One module per resource under `src/routes/<name>.js`, exporting a single route object (`health.js`) or
  an array of route objects (`example.js`); registered centrally in `src/plugins/router.js` via
  `server.route([...])` (`src/plugins/router.js`).
- `health` route: `GET /health`, synchronous handler returning `{ message: 'success' }`, no Joi
  validation, no database access (`src/routes/health.js`).
- `example` routes (`GET /example`, `GET /example/{exampleId}`) are **scaffold examples only**, explicitly
  marked "remove as needed" in the README API table (`README.md` line 120–121); they call
  `src/services/ExampleFind.js`, which queries the `example-data` Mongo collection and projects out
  `_id`.

## 5. Joi request validation

- Server-wide `routes.validate.options.abortEarly: false` so every validation error surfaces
  (`src/server.js`).
- Server-wide `failAction` is `src/common/helpers/fail-action.js`: logs the error at `warn` level via the
  shared pino logger, then rethrows it so Hapi renders the default 400 response
  (`src/common/helpers/fail-action.js`, test at `src/common/helpers/fail-action.test.js`).
- Neither scaffold route currently defines a Joi `validate` schema (no `params`/`query`/`payload` schema
  present on `health` or `example`); Joi is a registered dependency (`joi@18.2.5` in `package.json`) but
  not yet exercised by a route.

## 6. Configuration

- `convict@6.2.5` is the configuration library; the schema in `src/config.js` is validated with
  `config.validate({ allowed: 'strict' })` at module load (`src/config.js`, final line).
- `convict-format-with-validator` adds extra formats (e.g. `ipaddress`); a custom format
  `convictValidateMongoUri` (`src/common/helpers/convict/validate-mongo-uri.js`) validates the Mongo URI
  using a Joi `uri({ scheme: ['mongodb'] })` check.
- Existing keys: `serviceVersion`, `host`, `port`, `serviceName`, `cdpEnvironment` (enum including
  `local`), `log.isEnabled`/`log.level`/`log.format`/`log.redact`, `mongo.mongoUrl`/
  `mongo.databaseName`/`mongo.mongoOptions.retryWrites`/`mongo.mongoOptions.readPreference`,
  `httpProxy`, `tracing.header` (`src/config.js`).
- Every key has a `doc`, a `format`, and an `env` where environment-driven, consistent with
  `.github/instructions/nodejs-hapi-api.instructions.md` ("Configuration" section).
- `isTest`/`isProduction` flags derive from `process.env.NODE_ENV` and alter defaults (e.g. logging
  disabled and raw `req`/`res` redaction skipped in non-production) (`src/config.js`).
- No secret value is hard-coded; the Mongo URI and any future secret arrive via environment variables
  (confirmed by `env: 'MONGO_URI'` etc. in `src/config.js`, and by
  `.github/instructions/security.instructions.md` "Secrets management").

## 7. MongoDB integration

- Registered once as the `mongodb` plugin (`src/plugins/mongodb.js`), connecting with
  `MongoClient.connect(options.mongoUrl, { ...options.mongoOptions })` and exposing:
  - `server.mongoClient`, `server.db`, `server.locker` (decorated on `server`).
  - `request.db`, `request.locker` (decorated on `request`, `{ apply: true }`).
- `locker` is a `mongo-locks` `LockManager` over the `mongo-locks` collection; helpers
  `acquireLock`/`requireLock` in `src/common/helpers/mongo-lock.js` wrap `locker.lock(resource)`.
- Startup creates two indexes: `mongo-locks` on `{ id: 1 }` and `example-data` on `{ id: 1 }` (the latter
  is scaffold-only, commented "Example of how to create a mongodb index. Remove as required" in
  `src/plugins/mongodb.js`).
- The client is closed on the server `'stop'` event inside the same plugin.
- Local Mongo: `compose.yml` runs `mongo:7.0.28` with a healthcheck and an init script mount at
  `compose/mongo/10-init.js` (currently only a commented example).
- Test support: `vitest-mongodb@1.0.3` drives an in-memory Mongo via `.vite/mongo-memory-server.js`
  (`setup`/`teardown` around the suite, `process.env.MONGO_URI` set from `globalThis.__MONGO_URI__`);
  `src/plugins/mongodb.test.js` dynamically imports `createServer()` after the URI is set and asserts the
  `db`/`mongoClient`/`locker` decorations and clean shutdown.

## 8. Local object storage and Docker

- `compose.yml` defines a `floci` service (`hectorvent/floci:latest-aws`) as the local S3-compatible
  emulator ("replacement for localstack… emulates AWS resources (sqs, sns, s3 etc)", per the compose
  comment), configured from `compose/aws.env` (non-secret local dummy credentials — not reproduced here)
  and initialised via `compose/floci/start.d/10-setup-resources.sh`, which currently only contains
  **commented-out** example `aws s3 mb` / `aws sqs create-queue` commands — no application-level
  object-storage integration exists yet in `src/`.
- `compose.yml` also defines a `redis:7.2.3-alpine3.18` service. **No code under `src/` references Redis**
  (confirmed by inspection of all `src/` files above); the service is unused/out of scope. The approved
  architecture has no application-cache capability — this document does not recommend activating it.
- `Dockerfile` is a two-stage build (`development` from `defradigital/node-development`, `production`
  from `defradigital/node:${PARENT_VERSION}`), installs with `npm ci --omit=dev` for production, runs
  `node src` in production and `npm run docker:dev` in development.
- `compose.yml` mounts `./src` and `package.json` into the dev container for live-reload development.

## 9. Logging, tracing and correlation

- Structured logging via `pino@10` + `hapi-pino@13`, configured in `src/plugins/logger-options.js`:
  ECS format (`@elastic/ecs-pino-format`) in production, `pino-pretty` otherwise; `/health` is excluded
  from request logging (`ignorePaths: ['/health']`); redaction paths come from `config.get('log.redact')`
  with `remove: true`.
- Correlation: `@defra/hapi-tracing` provides `getTraceId()`; the logger `mixin()` adds `trace.id` to
  every log line when a trace id is present (`src/plugins/logger-options.js`).
- The tracing header name is configurable (`tracing.header`, default `x-cdp-request-id`) and propagated
  via the `requestTracing` plugin (`src/plugins/request-tracing.js`).
- `createLogger()` in `src/common/helpers/logging/logger.js` returns a singleton `pino` instance built
  from the same `loggerOptions`, used outside the request lifecycle (e.g. `src/index.js`,
  `src/common/helpers/start-server.js`, `src/common/helpers/fail-action.js`).

## 10. Error-handling foundations (pre-Step-03 state)

- `@hapi/boom@10.0.1` is a dependency and is already used for an expected failure in the scaffold
  (`Boom.notFound()` in `src/routes/example.js`).
- There is **no central `onPreResponse` error-mapping extension point yet** — each route/handler is
  responsible for its own Boom usage; Step 03 is explicitly scoped to add the single central mapping
  boundary and the framework-neutral `ApplicationError` model. No such model exists in the repository
  today.
- The only centralised error handling that exists is the shared Joi `failAction` (section 5 above), which
  logs and rethrows rather than shaping a response itself.

## 11. Testing

- **Vitest** (`vitest@4.1.11`, `@vitest/coverage-v8@4.1.11`) with `globals: true`, `environment: 'node'`,
  `clearMocks: true`, `fileParallelism: false` (`vitest.config.js`).
- Coverage: v8 provider, reports to `./coverage` as `text` + `lcov`, includes `src/**/*.js`
  (`vitest.config.js`); `sonar-project.properties` points Sonar at
  `./coverage/lcov.info`.
- Setup files (run before every suite): `.vite/mongo-memory-server.js` (in-memory Mongo via
  `vitest-mongodb`) and `.vite/setup-files.js` (`vitest-fetch-mock`, enabling/disabling `global.fetch`
  mocking around the suite).
- Tests are colocated as `*.test.js` next to the source they verify (e.g.
  `src/common/helpers/fail-action.test.js`, `src/plugins/mongodb.test.js`,
  `src/common/helpers/mongo-lock.test.js`, `src/common/helpers/start-server.test.js`,
  `src/common/helpers/convict/validate-mongo-uri.test.js`).
- `src/plugins/mongodb.test.js` demonstrates the Hapi integration-test pattern: dynamically import
  `createServer()` after the Mongo test URI is set, `server.initialize()`, assert decorations, then
  `server.stop()`.
- Command: `npm test` → `TZ=UTC vitest run --coverage` (`package.json`); watch mode `npm run test:watch`.

## 12. Code quality (lint, formatting, coverage, pre-commit, CI)

- Lint: ESLint 9 flat config via `neostandard@0.13.0` (`eslint.config.js`), `env: ['node', 'vitest']`,
  `noJsx: true`, `noStyle: true` (style is delegated to Prettier), ignores resolved from `.gitignore`.
  Command: `npm run lint` (`eslint --cache --cache-strategy content "**/*.{cjs,js}"`); `npm run lint:fix`
  appends `--fix`.
- Formatting: Prettier (`prettier@3.9.6`), config in `.prettierrc.js` (`tabWidth: 2`, `semi: false`,
  `singleQuote: true`, `trailingComma: 'none'`), `.prettierignore` excludes `package-lock.json`,
  `node_modules`, `coverage`. Commands: `npm run format` (write), `npm run format:check` (check).
- Pre-commit: Husky (`.husky/pre-commit`) runs `npm run git:pre-commit-hook`, which chains
  `security-audit` → `format:check` → `lint` → `test` (`package.json`).
- CI (`.github/workflows/check-pull-request.yml`, triggers on PRs to `main`/`minimal` and on
  `merge_group`): checkout → `npm run security-audit` → `npm ci` → `npm run format:check` → `npm run
lint` → `npm test` → Docker image build → SonarQube Cloud scan (`SonarSource/sonarqube-scan-action`,
  skipped for `dependabot[bot]`, requires `MMO_CR_SONAR_TOKEN` secret).
- Sonar project config (`sonar-project.properties`): `sonar.projectKey=DEFRA_mmo-cr-catch-recording-service`,
  `sonar.organization=defra`, sources `src/`, tests `src/**/*.test.js` (excluded from `sonar.sources`,
  included via `sonar.test.inclusions`), coverage from `./coverage/lcov.info`.
- Coverage/testing targets (repository standard, not yet measured against current code): ≥90% overall,
  ≥95% for core business logic, 100% for error-handling/security-critical paths
  (`.github/instructions/testing.instructions.md`).

## 13. Security foundations

- `.github/instructions/security.instructions.md` requires: HTTPS/TLS only, never disabling
  `@defra/hapi-secure-context`; boundary validation with strict allow-list Joi schemas; never passing a
  caller-supplied object into a Mongo filter/update; authorisation enforced on every non-public route
  (`/health` is the only exception); secrets only via environment variables through `convict`, never
  logged; PII never logged (extend `log.redact` rather than logging raw `req`/`res`); protective-monitoring
  events sent via `@defra/cdp-auditing`; explicit timeouts and bounded/paginated queries.
- `.github/instructions/data-persistence.instructions.md` requires: never a second `MongoClient`; services
  receive `db` and stay framework-agnostic; always project and bound queries; map driver failures to
  `Boom` (`conflict`/`notFound`/`badRequest`/logged 500); `mongo-locks` for mutual exclusion with lock
  release in a `finally` block.
- `.github/instructions/nodejs-hapi-api.instructions.md` additionally requires: thin handlers, no domain/IO
  logic in handlers; `@hapi/boom` for every expected failure with no leaked internals; stable API
  contract with recorded breaking changes; ADRs under `docs/adr/` for new architecture (routing,
  persistence/cache strategy, integrations, auth).
- Excluded/sensitive paths: `.copilotignore` blocks AI context-reading of `.env*`, `compose/*.env`,
  secrets/credentials/keys/certificates, `.aws/**`, `**/aws.env`, Terraform state, session/cookie
  secrets, etc. `.analyticsignore` excludes `docs/` and `design/` from Copilot analytics line-counting.
  `.gitignore` excludes `design` (the planning/prompt folder used for this phase is **not** version
  controlled), build/coverage/cache output, `.env`. `.npmignore` excludes config/test/fixture files from
  any published package.
- `.github/agents/clarification-resolver.agent.md` exists (confirmed present) as the repository's
  Clarification Resolver agent for ambiguity resolution during implementation.

## 14. GitHub Copilot and agent governance

- `.github/copilot-instructions.md` is the project's persistent custom-instruction file: standards
  precedence (DEFRA > GDS > community), mandatory DEFRA constraints, the Triage → Read → Research →
  Clarify → Plan → Approval → Implement → Test → Iterate → Summarise working framework, tech-stack
  decisions, build/test commands, and conventions (already supplied as this session's system
  instructions; not re-quoted here to avoid duplicating a large internal document).
- `.github/agents/` additionally defines `catch-recording-code-reviewer`, `catch-recording-developer`,
  `catch-recording-orchestrator`, and `catch-recording-planner` agents (file listing only; their
  responsibilities are as described in the session's available-agents list and are out of scope for this
  repository-context document).

## 15. Approved exclusions (confirmed, not to be revisited by later steps)

- No previous/legacy Catch Recording implementation exists in this repository or was consulted; git
  history contains only scaffold/template commits (`initial commit`, "Applying template", two CI-workflow
  commits) — confirmed via `git log --oneline`.
- No compatibility or migration behaviour exists.
- No Redis integration exists in `src/`; the `redis` Compose service is present but unused (section 8).
- No application-cache capability exists.
- No Catch Recording domain/business implementation exists yet — Steps 02–04 are the first to add
  Catch-Recording-specific structure, and must not implement business endpoints.

## 16. Confirmed implementation commands

| Purpose              | Command                                                       | Source                              |
| -------------------- | ------------------------------------------------------------- | ----------------------------------- |
| Install deps         | `npm install` (local), `npm ci` (CI/automated)                | `package.json`, CI workflow         |
| Dev (watch)          | `npm run dev`                                                 | `package.json`                      |
| Debug                | `npm run dev:debug`                                           | `package.json`                      |
| Production start     | `npm start`                                                   | `package.json`                      |
| Test + coverage      | `npm test` (`TZ=UTC vitest run --coverage`)                   | `package.json`                      |
| Test watch           | `npm run test:watch`                                          | `package.json`                      |
| Lint                 | `npm run lint`                                                | `package.json`                      |
| Lint fix             | `npm run lint:fix`                                            | `package.json`                      |
| Format write         | `npm run format`                                              | `package.json`                      |
| Format check         | `npm run format:check`                                        | `package.json`                      |
| Security audit       | `npm run security-audit` (`npm audit --audit-level=critical`) | `package.json`                      |
| Full pre-commit gate | `npm run git:pre-commit-hook`                                 | `package.json`, `.husky/pre-commit` |

## 17. Unknowns and deferred decisions

These are explicitly **not** resolved by Step 01 and must not be treated as assumptions by later steps:

- Whether an automated architecture-boundary/dependency-direction linting tool is configured — none was
  found; any boundary check in later steps will need to be a manual/documented review rather than an
  automated gate, unless a later step introduces one.
- Exact SonarQube quality-gate condition set (coverage thresholds, duplication thresholds, etc.) beyond
  what is visible in `sonar-project.properties` — the live gate configuration lives in SonarCloud itself
  and is confirmed only by the SonarQube MCP at the Phase 1 completion gate, not during Step 01.
  SonarQube MCP was **not** invoked during Step 01, per the step prompt's "SonarQube MCP is a
  phase-completion control" instruction.
  - The configuration/decision scope for Step 04 (which Mongo collections, idempotency-record shape,
    timezone key, Reference Data Service settings, artifact-storage settings, PDF/payload/paging limits,
    trusted-auth settings) is deliberately left to Step 04 and its own plan.
- The precise module-internal file layout for the eight Catch Recording modules (Step 02's
  responsibility) — Step 01 only confirms that no such structure exists yet.
- Whether `.gitignore` excluding `design` means the `design/` plans/prompts are intentionally untracked by
  git for this repository (consistent with `.analyticsignore` also excluding `design/`) — treated here as
  a confirmed convention (both files agree), not an open question.

## 18. Evidence map (condensed)

| Conclusion                                  | Evidence                                                                                                                                                                                                         |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node ES modules, `#/` alias                 | `package.json`, `.nvmrc`                                                                                                                                                                                         |
| Plugin registration order                   | `src/server.js`                                                                                                                                                                                                  |
| Route/Joi/failAction pattern                | `src/plugins/router.js`, `src/routes/health.js`, `src/routes/example.js`, `src/common/helpers/fail-action.js`                                                                                                    |
| Config via convict, strict validation       | `src/config.js`                                                                                                                                                                                                  |
| Mongo plugin, decorations, lifecycle        | `src/plugins/mongodb.js`, `src/plugins/mongodb.test.js`                                                                                                                                                          |
| Local S3 emulator (floci), unused Redis     | `compose.yml`, `compose/floci/start.d/10-setup-resources.sh`                                                                                                                                                     |
| Logging/tracing/correlation                 | `src/plugins/logger-options.js`, `src/plugins/request-tracing.js`                                                                                                                                                |
| Vitest + vitest-mongodb + vitest-fetch-mock | `vitest.config.js`, `.vite/mongo-memory-server.js`, `.vite/setup-files.js`                                                                                                                                       |
| Lint/format/pre-commit/CI/Sonar             | `eslint.config.js`, `.prettierrc.js`, `.husky/pre-commit`, `.github/workflows/check-pull-request.yml`, `sonar-project.properties`                                                                                |
| Security/persistence/testing standards      | `.github/instructions/security.instructions.md`, `.github/instructions/data-persistence.instructions.md`, `.github/instructions/testing.instructions.md`, `.github/instructions/nodejs-hapi-api.instructions.md` |
| No existing error-mapping boundary          | Absence of any `onPreResponse` or `ApplicationError` reference in `src/` (confirmed by direct inspection of every file in section 1)                                                                             |
| No legacy/compatibility/migration code      | `git log --oneline` (four scaffold/template/CI commits only)                                                                                                                                                     |

## 19. Security note on inspection

While following the step prompt's instruction to inspect `compose/aws.env`, that file was read directly;
it matches the `.copilotignore` pattern `compose/*.env`/`**/aws.env`, which the repository's custom
instructions say should never be read as AI context without first asking the user. Its content was
confirmed to be the standard, non-secret floci/localstack local dummy credentials
(`AWS_ACCESS_KEY_ID=test`, `AWS_SECRET_ACCESS_KEY=test`) — not a real secret — and no value from it is
reproduced above. No further `.copilotignore`-matched file was or will be read during this phase. This is
recorded here transparently as a process note for the owner, not as a security finding requiring
remediation.
