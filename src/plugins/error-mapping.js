import { mapErrorToHttpResponse } from '#/common/helpers/errors/http-error-mapper.js'

// Central HTTP error-mapping plugin (Step 03). Registers a single onPreResponse extension that rewrites
// every Boom-shaped error response into the approved safe public shape (see
// src/common/helpers/errors/http-error-mapper.js and docs/adr/0002-centralised-http-error-mapping.md).
// Successful (non-error) responses are returned unchanged.
export const errorMapping = {
  plugin: {
    name: 'error-mapping',
    register(server) {
      server.ext('onPreResponse', (request, h) => {
        const response = request.response

        if (!response?.isBoom) {
          return h.continue
        }

        const { statusCode, payload } = mapErrorToHttpResponse(response)

        response.output.statusCode = statusCode
        response.output.payload = payload

        return h.continue
      })
    }
  }
}
