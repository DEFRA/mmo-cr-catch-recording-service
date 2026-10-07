import { readFileSync } from 'node:fs'

/** Every file in this module must avoid Hapi, Boom, Joi, and MongoDB. */
const FRAMEWORK_NEUTRAL_FILES = [
  'artifact-keys.js',
  'artifact-errors.js',
  'catch-artifact.js',
  's3-artifact-store.js'
]

/** `catch-artifact.js` (the `CatchArtifact` port) and `artifact-keys.js`/`artifact-errors.js` must not
 * depend on the AWS SDK directly - only `s3-artifact-store.js` (the adapter) may. */
const SDK_FREE_FILES = [
  'artifact-keys.js',
  'artifact-errors.js',
  'catch-artifact.js'
]

describe('#architecture-boundary (artifact)', () => {
  test.each(FRAMEWORK_NEUTRAL_FILES)(
    '%s should not import Hapi, Boom, Joi, or MongoDB',
    (fileName) => {
      const source = readFileSync(
        new URL(`./${fileName}`, import.meta.url),
        'utf8'
      )

      expect(source).not.toMatch(/from\s+['"]@hapi\/hapi['"]/)
      expect(source).not.toMatch(/from\s+['"]@hapi\/boom['"]/)
      expect(source).not.toMatch(/from\s+['"]joi['"]/)
      expect(source).not.toMatch(/from\s+['"]mongodb['"]/)
    }
  )

  test.each(SDK_FREE_FILES)(
    '%s should not import the AWS SDK directly (adapter-only dependency)',
    (fileName) => {
      const source = readFileSync(
        new URL(`./${fileName}`, import.meta.url),
        'utf8'
      )

      expect(source).not.toMatch(/from\s+['"]@aws-sdk\//)
    }
  )
})
