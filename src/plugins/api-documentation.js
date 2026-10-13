import HapiSwagger from 'hapi-swagger'

/**
 * Step 41: live, auto-generated API documentation, built directly from the registered Hapi routes and
 * their Joi `validate`/`response.schema` definitions — never a hand-maintained parallel document.
 *
 * `hapi-swagger` only ever produces OpenAPI **3.0.0** (`OAS: 'v3.0'`) — it has no 3.1 mode (verified
 * against its own source, which hard-codes the `openapi` field to `'3.0.0'`), and the upstream project
 * is archived/unmaintained. This is an accepted, explicit trade-off: a live, evidence-accurate contract
 * generated from the real routes, at the cost of being OpenAPI 3.0 rather than 3.1.
 *
 * Served publicly (no `authentication-service` requirement) at the plugin's own defaults:
 * `GET /openapi.json` (the machine-readable document) and `GET /documentation` (interactive Swagger
 * UI) — matching the common convention of publishing an API contract for easy discovery/integration.
 *
 * Only routes carrying the `api` tag are included — every Catch Recording, vessel-profile, platform,
 * and example route in this repository is tagged accordingly.
 */
export const apiDocumentation = {
  plugin: HapiSwagger,
  options: {
    info: {
      title: 'MMO Catch Recording — Catch Recording Service API',
      version: '1.0.0',
      description:
        'Live, auto-generated OpenAPI 3.0 documentation for the Catch Recording Service, built from ' +
        'the registered Hapi routes and their Joi request/response schemas.'
    },
    OAS: 'v3.0',
    jsonPath: '/openapi.json',
    documentationPath: '/documentation',
    grouping: 'tags',
    auth: false
  }
}
