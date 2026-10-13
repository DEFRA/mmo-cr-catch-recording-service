import { health } from '#/routes/health.js'
import { example } from '#/routes/example.js'
import { catchRecords } from '#/routes/catch-records.js'
import { vesselProfiles } from '#/routes/vessel-profiles.js'

/**
 * Step 41: live, auto-generated API documentation (`hapi-swagger`, registered as `apiDocumentation` in
 * `src/server.js`).
 *
 * Uses the real `createServer()` (the same one `src/index.js` starts), so this proves the actual
 * registered plugin stack — not a hand-rolled stand-in — produces a valid document covering every real
 * route, and that adding `tags`/`response` metadata to every route left existing behaviour (`/health`,
 * `/example`) unchanged.
 */

const HTTP_METHODS = Object.freeze([
  'get',
  'post',
  'put',
  'patch',
  'delete',
  'head',
  'options'
])

function registeredRoutes() {
  return [health].concat(example).concat(catchRecords).concat(vesselProfiles)
}

function toOperationKey({ method, path }) {
  return `${method.toUpperCase()} ${path}`
}

function documentedOperationKeys(document) {
  const keys = []

  for (const [path, pathItem] of Object.entries(document.paths ?? {})) {
    for (const method of HTTP_METHODS) {
      if (pathItem[method]) {
        keys.push(toOperationKey({ method, path }))
      }
    }
  }

  return keys
}

describe('apiDocumentation (hapi-swagger)', () => {
  let server

  beforeAll(async () => {
    const { createServer } = await import('#/server.js')
    server = await createServer()
    await server.initialize()
  })

  afterAll(async () => {
    await server.stop()
  })

  test('GET /openapi.json returns a valid OpenAPI 3.0.0 document', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/openapi.json'
    })

    expect(response.statusCode).toBe(200)
    const document = JSON.parse(response.payload)
    expect(document.openapi).toBe('3.0.0')
    expect(document.info).toMatchObject({
      title: 'MMO Catch Recording — Catch Recording Service API',
      version: '1.0.0'
    })
  })

  test('documents every registered route (no missing, no extra)', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/openapi.json'
    })
    const document = JSON.parse(response.payload)

    const registered = new Set(
      registeredRoutes().map((route) =>
        toOperationKey({ method: route.method, path: route.path })
      )
    )
    const documented = new Set(documentedOperationKeys(document))

    expect([...registered].filter((key) => !documented.has(key))).toEqual([])
    expect([...documented].filter((key) => !registered.has(key))).toEqual([])
    expect(registered.size).toBe(27)
  })

  test('GET /documentation serves the interactive Swagger UI page', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/documentation'
    })

    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toContain('text/html')
  })

  test('both documentation endpoints remain unauthenticated', async () => {
    const jsonResponse = await server.inject({
      method: 'GET',
      url: '/openapi.json'
    })
    const uiResponse = await server.inject({
      method: 'GET',
      url: '/documentation'
    })

    expect(jsonResponse.statusCode).not.toBe(401)
    expect(uiResponse.statusCode).not.toBe(401)
  })

  test('GET /health behaviour is unchanged by its new response schema', async () => {
    const response = await server.inject({ method: 'GET', url: '/health' })

    expect(response.statusCode).toBe(200)
    expect(JSON.parse(response.payload)).toEqual({ message: 'success' })
  })

  test('GET /example behaviour is unchanged by its new response schema', async () => {
    const response = await server.inject({ method: 'GET', url: '/example' })

    expect(response.statusCode).toBe(200)
    expect(JSON.parse(response.payload)).toEqual([])
  })

  test('GET /example/{exampleId} behaviour is unchanged for a missing id', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/example/does-not-exist'
    })

    expect(response.statusCode).toBe(404)
  })
})
