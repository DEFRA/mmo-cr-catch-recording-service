import {
  openApiContractJson,
  openApiContractYaml
} from '#/openapi/load-openapi-contract.js'

/**
 * Serves the one committed OpenAPI 3.1 contract (`src/openapi/openapi.yaml`) at runtime, in both of
 * its public representations. Deliberately unauthenticated (like `/health` and `/example`) and
 * deliberately not part of the documented contract itself — these are documentation-delivery routes,
 * not Catch Recording Service API operations.
 */
export const openapi = [
  {
    method: 'GET',
    path: '/openapi.json',
    handler: (_request, h) =>
      h.response(openApiContractJson).type('application/json')
  },
  {
    method: 'GET',
    path: '/openapi.yaml',
    handler: (_request, h) =>
      h.response(openApiContractYaml).type('application/yaml')
  }
]
