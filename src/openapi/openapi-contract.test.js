import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'

import { health } from '#/routes/health.js'
import { example } from '#/routes/example.js'
import { catchRecords } from '#/routes/catch-records.js'
import { vesselProfiles } from '#/routes/vessel-profiles.js'

/**
 * Drift-detection suite for `src/openapi/openapi.yaml`. Proves the committed contract parses, is
 * internally well-formed, and matches every currently registered Catch Recording Service route — in
 * both directions — without booting a server. The real route arrays are imported directly from
 * `src/routes/*.js`, the same arrays `src/plugins/router.js` registers with Hapi, so this test fails
 * whenever a future route change is not reflected in the committed contract (or vice versa).
 *
 * The two OpenAPI-delivery routes (`GET /openapi.json`, `GET /openapi.yaml`, from `src/routes/openapi.js`)
 * are deliberately excluded — they are documentation-delivery routes, not Catch Recording Service API
 * operations, and are not part of the documented contract itself (see `src/routes/openapi.test.js` for
 * their own coverage).
 */

const CONTRACT_PATH = fileURLToPath(new URL('./openapi.yaml', import.meta.url))
const contractYaml = readFileSync(CONTRACT_PATH, 'utf8')
const contract = parse(contractYaml)

const REGISTERED_ROUTES = [health]
  .concat(example)
  .concat(catchRecords)
  .concat(vesselProfiles)

function registeredOperationKeys() {
  return new Set(
    REGISTERED_ROUTES.map(
      (route) => `${route.method.toUpperCase()} ${route.path}`
    )
  )
}

function documentedOperationKeys() {
  const keys = []

  for (const [path, pathItem] of Object.entries(contract.paths ?? {})) {
    for (const method of Object.keys(pathItem)) {
      if (['get', 'post', 'put', 'patch', 'delete'].includes(method)) {
        keys.push(`${method.toUpperCase()} ${path}`)
      }
    }
  }

  return new Set(keys)
}

function allOperationObjects() {
  const operations = []

  for (const pathItem of Object.values(contract.paths ?? {})) {
    for (const [method, operation] of Object.entries(pathItem)) {
      if (['get', 'post', 'put', 'patch', 'delete'].includes(method)) {
        operations.push(operation)
      }
    }
  }

  return operations
}

describe('src/openapi/openapi.yaml contract', () => {
  it('parses successfully and declares OpenAPI 3.1.0', () => {
    expect(contract.openapi).toBe('3.1.0')
    expect(contract.info?.title).toBeTypeOf('string')
    expect(contract.info?.version).toBeTypeOf('string')
  })

  it('declares a unique, stable operationId for every operation', () => {
    const operationIds = allOperationObjects().map(
      (operation) => operation.operationId
    )

    expect(
      operationIds.every((id) => typeof id === 'string' && id.length > 0)
    ).toBe(true)
    expect(new Set(operationIds).size).toBe(operationIds.length)
  })

  it('documents every currently registered route and no extra operation', () => {
    const registered = registeredOperationKeys()
    const documented = documentedOperationKeys()

    const missingFromContract = [...registered].filter(
      (key) => !documented.has(key)
    )
    const extraInContract = [...documented].filter(
      (key) => !registered.has(key)
    )

    expect(missingFromContract).toEqual([])
    expect(extraInContract).toEqual([])
  })

  it('marks /health and /example as explicitly public (security: [])', () => {
    expect(contract.paths['/health'].get.security).toEqual([])
    expect(contract.paths['/example'].get.security).toEqual([])
    expect(contract.paths['/example/{exampleId}'].get.security).toEqual([])
  })

  it('defaults every other operation to the global bearer security requirement', () => {
    expect(contract.security).toEqual([{ bearerAuth: [] }])
    expect(contract.components.securitySchemes.bearerAuth).toEqual({
      type: 'http',
      scheme: 'bearer',
      description: expect.any(String)
    })

    const catchRecordsListOperation = contract.paths['/v1/catch-records'].get
    expect(catchRecordsListOperation.security).toBeUndefined()
  })

  it('declares the shared public error schema matching the central error mapper contract', () => {
    const errorSchema = contract.components.schemas.ErrorResponse
    expect(errorSchema.required).toEqual(
      expect.arrayContaining(['statusCode', 'code', 'message'])
    )
    expect(Object.keys(errorSchema.properties)).toEqual(
      expect.arrayContaining([
        'statusCode',
        'code',
        'message',
        'correlationId',
        'details'
      ])
    )
  })
})
