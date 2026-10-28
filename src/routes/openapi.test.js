import Hapi from '@hapi/hapi'
import { parse } from 'yaml'

import { openapi } from './openapi.js'
import {
  openApiContractJson,
  openApiContractYaml
} from '#/openapi/load-openapi-contract.js'

async function createTestServer() {
  const server = Hapi.server()
  server.route(openapi)
  return server
}

describe('openapi routes', () => {
  it('serves the committed contract as JSON at GET /openapi.json, unauthenticated', async () => {
    const server = await createTestServer()

    const { statusCode, headers, result } = await server.inject({
      method: 'GET',
      url: '/openapi.json'
    })

    expect(statusCode).toBe(200)
    expect(headers['content-type']).toContain('application/json')
    expect(result).toEqual(openApiContractJson)
    expect(result.openapi).toBe('3.1.0')
  })

  it('serves the committed contract as YAML at GET /openapi.yaml, unauthenticated', async () => {
    const server = await createTestServer()

    const { statusCode, headers, result } = await server.inject({
      method: 'GET',
      url: '/openapi.yaml'
    })

    expect(statusCode).toBe(200)
    expect(headers['content-type']).toContain('application/yaml')
    expect(result).toBe(openApiContractYaml)
    expect(parse(result)).toEqual(openApiContractJson)
  })

  it('serves exactly the same contract from both endpoints', async () => {
    const server = await createTestServer()

    const jsonResponse = await server.inject({
      method: 'GET',
      url: '/openapi.json'
    })
    const yamlResponse = await server.inject({
      method: 'GET',
      url: '/openapi.yaml'
    })

    expect(jsonResponse.result).toEqual(parse(yamlResponse.result))
  })
})
