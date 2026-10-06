import { readFileSync } from 'node:fs'

const FRAMEWORK_NEUTRAL_FILES = [
  'reference-data-errors.js',
  'stable-id.js',
  'response-validators.js',
  'http-status.js',
  'reference-data-http-client.js',
  'vessels-client.js',
  'gears-client.js',
  'ports-client.js',
  'species-client.js',
  'statistical-areas-client.js',
  'reference-data-client.js',
  'active-selection.js',
  'snapshot-mappers.js',
  'reference-resolvers.js',
  'vessel-resolution.js',
  'historical-snapshot.js'
]

describe('#architecture-boundary (reference-data)', () => {
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

  test.each(FRAMEWORK_NEUTRAL_FILES)(
    '%s should not import CatchPersistence or any cache module',
    (fileName) => {
      const source = readFileSync(
        new URL(`./${fileName}`, import.meta.url),
        'utf8'
      )

      expect(source).not.toMatch(/from\s+['"].*persistence[^'"]*['"]/i)
      expect(source).not.toMatch(/from\s+['"]redis['"]/i)
    }
  )
})
