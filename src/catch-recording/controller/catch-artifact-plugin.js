import { createS3CatchArtifactStore } from '#/catch-recording/artifact/s3-artifact-store.js'

/**
 * Registers the production S3-compatible `CatchArtifact` storage adapter once and decorates
 * `request.catchArtifactStore` with it (mirrors the existing `mongoDb`/`reference-data` plugins'
 * decoration pattern). Built once from `options` (`config.get('catchArtifacts')`) - never rebuilt per
 * request.
 */
export const catchArtifactPlugin = {
  plugin: {
    name: 'catch-artifact',
    once: true,
    register: (server, options) => {
      const catchArtifactStore = createS3CatchArtifactStore(options)
      server.decorate(
        'request',
        'catchArtifactStore',
        () => catchArtifactStore,
        {
          apply: true
        }
      )
    }
  }
}
