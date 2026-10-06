import { createReferenceDataClient } from '#/catch-recording/reference-data/reference-data-client.js'

/**
 * Registers the Reference Data Service client once and decorates `request.referenceDataClient` with it
 * (mirrors the existing `mongoDb` plugin's `request.db` decoration pattern). Built once from `options`
 * (`config.get('referenceData')` plus the shared tracing header) — never rebuilt per request.
 */
export const referenceDataPlugin = {
  plugin: {
    name: 'reference-data',
    once: true,
    register: (server, options) => {
      const referenceDataClient = createReferenceDataClient(options)
      server.decorate(
        'request',
        'referenceDataClient',
        () => referenceDataClient,
        {
          apply: true
        }
      )
    }
  }
}
