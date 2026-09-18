---
description: 'Node.js, Hapi.js and API coding standards for the MMO Catch Recording Catch Recording Service: ES modules, Hapi server/plugin composition, route modules, Joi validation, Boom errors, thin handlers, convict config, structured logging and project layout. Use when writing or reviewing backend service code.'
applyTo: 'src/**/*.js'
---

# Node.js, Hapi & API standards

Precedence: DEFRA standards > GDS > community. Where DEFRA is silent, follow the
[DEFRA Node.js standards](https://defra.github.io/software-development-standards/standards/node_standards/)
and idiomatic Hapi/Node.js guidance.

## Language & style

- **ES Modules** (`type: module`, Node **≥ 24**). Use `import`/`export`; no CommonJS in `src/`.
- **Import alias:** use `#/` for `src/` (e.g. `import { config } from '#/config.js'`). Keep the `.js`
  extension on relative/aliased imports.
- **Style:** `neostandard` (Standard-style — no semicolons, single quotes, 2-space indent). Don't fight the
  formatter (ESLint + Prettier). Run `npm run lint` and `npm run format`.
- **Naming:** `lowerCamelCase` for variables/functions, `UpperCamelCase` for classes/constructors. Booleans
  read as assertions (`isValid`, `hasError`). Name by role; omit needless words.
- **Functions:** prefer small, pure functions; return values rather than mutating arguments. Use
  `async/await` and **propagate errors** — do not swallow them.
- **Immutability:** prefer `const`; avoid shared mutable module state.
- **Never block the event loop.** Push CPU-intensive work off the request path
  ([why](https://nodejs.org/en/docs/guides/dont-block-the-event-loop/)).

## Hapi server & plugins

- The server is created in `src/server.js` and registers, in order: `requestLogger`, `requestTracing`,
  `metrics`, `secureContext`, `pulse`, `mongoDb` and `router`. Follow that composition; register new
  cross-cutting behaviour as a plugin under `src/plugins/`.
- Server-wide route defaults (`validate.options.abortEarly: false`, the shared `failAction`, and the
  `security` headers block: HSTS, `xss`, `noSniff`, `xframe`) are set in `createServer()`. **Do not weaken
  them** and do not override them per-route without justification.
- `stripTrailingSlash` is on — define paths without a trailing slash.

## Routes

- **One module per resource** under `src/routes/<name>.js`, exporting either a single route object or an
  array of them. Register it in `src/plugins/router.js`. Follow the existing `health.js` / `example.js`.
- A route definition owns: `method`, `path`, `options.validate` (Joi) and a **thin** `handler`.
- **Validate at the boundary.** Give every route a Joi schema for whatever it accepts — `params`, `query`,
  `payload`, and `headers` where relevant. Keep `abortEarly: false` so all errors surface. Never trust a
  caller.
- **Path parameters** are validated and typed (`Joi.string().guid()`, `Joi.number().integer().min(1)`, …),
  never passed straight into a query.
- **`/health` stays fast, unauthenticated and dependency-safe** so the platform can probe it. Do not add a
  database round-trip to it.

## Handlers (thin)

- A handler validates (via the route schema), calls a **service**, and shapes the response. Nothing else.
- **No domain or IO logic in handlers.** Business rules, data access and outbound calls live in
  `src/services/` (or `src/common/helpers/`) and are unit-tested directly, without a server.
- Return `h.response(body)` with an explicit status where it isn't 200; return a `Boom` error for failures.
- Use `request.logger` (pino) — never `console.log`. No secrets or PII in logs.

## Errors

- Use [`@hapi/boom`](https://hapi.dev/module/boom/) for every expected failure: `Boom.badRequest()`,
  `Boom.unauthorized()`, `Boom.forbidden()`, `Boom.notFound()`, `Boom.conflict()`.
- **Never leak internals.** No stack traces, driver errors, connection strings or upstream payloads in a
  response. Log the detail; return a safe, stable error shape.
- Validation failures go through the shared `failAction` in `src/common/helpers/fail-action.js`, which logs
  and rethrows so Hapi renders a consistent 400.
- An unexpected error must still produce a 500 with no internal detail — never a silent success.

## API contract

- The published contract is what consumers depend on. **Keep response shapes, status codes and error shapes
  stable.** Version any breaking change and record it; call breaking changes out explicitly in the PR.
- Use correct HTTP semantics: `GET` is safe and idempotent, `POST` creates (201 + location where it
  applies), `PUT`/`PATCH` update, `DELETE` removes (204 where there is no body).
- Document every route in the README's API section (and `docs/api-reference.md` where one exists) in the
  same change that adds or alters it.

## Configuration

- Use **convict** (`src/config.js`) for all configuration, validated with `allowed: 'strict'`. Every key
  needs a `doc`, a `format` and (where environment-driven) an `env`.
- **No secrets in source.** Secrets arrive as environment variables from the CDP Portal; non-secret
  environment values come from `cdp-app-config`. Document new keys in the README.
- Respect the existing config for host/port, log level/format/redaction, Mongo URI and options, the HTTP
  proxy and the tracing header.

## Outbound calls

- Route outbound HTTP through the platform **proxy dispatcher** where required (`httpProxy` config), with
  explicit timeouts. Handle failure explicitly — never let a hung dependency hang a request.
- **Never disable TLS verification.** `@defra/hapi-secure-context` loads the CA certificates.
- Treat every external response as untrusted: validate its shape before using it.

## Dependencies

- Prefer well-maintained, licence-compatible, minimal dependencies per DEFRA
  [choosing packages](https://defra.github.io/software-development-standards/guides/choosing_packages/).
- **Pin exact versions** in `package.json` — no `^`, `~`, `*` or `x` ranges (enforced by `save-exact=true`
  in `.npmrc`). Use `npm ci` in automated builds. Run `npm run security-audit`.
- **No TypeScript** without an approved DEFRA exemption.

## Project layout (current)

```
mmo-cr-catch-recording-service/
├── src/
│   ├── index.js                     # entry point; unhandled-rejection guard
│   ├── config.js                    # convict schema (validated strict)
│   ├── server.js                    # Hapi server + plugin registration
│   ├── plugins/                     # router, mongodb, pulse, request-logger, request-tracing, logger-options
│   ├── routes/                      # one module per resource (health.js, example.js)
│   ├── services/                    # domain/IO logic, framework-agnostic
│   └── common/helpers/              # fail-action, mongo-lock, start-server, logging, convict formats
├── docs/
│   └── adr/                         # Architecture Decision Records
└── README.md
```

## Notes

- **One module per resource** under `routes/`, registered in `plugins/router.js`.
- **services/** holds the domain logic; handlers stay thin and delegate to it.
- **common/helpers/** holds cross-cutting helpers shared by plugins and services.
- Capture architecture decisions (new routing pattern, persistence or cache strategy, integrations, auth)
  as ADRs under `docs/adr/`.
