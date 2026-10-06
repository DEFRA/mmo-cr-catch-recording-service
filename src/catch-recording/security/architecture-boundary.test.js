import { readFileSync } from 'node:fs'

const FRAMEWORK_NEUTRAL_FILES = [
  'policy-outcome.js',
  'policy-errors.js',
  'ownership-policy.js',
  'resource-access-policy.js',
  'vessel-access-policy.js',
  'vessel-profile-policy.js',
  'completion-policy.js'
]

describe('#architecture-boundary (security)', () => {
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
    '%s should not import the Reference Data Service, CatchPersistence, or any cache module',
    (fileName) => {
      const source = readFileSync(
        new URL(`./${fileName}`, import.meta.url),
        'utf8'
      )

      expect(source).not.toMatch(/from\s+['"].*reference-data[^'"]*['"]/i)
      expect(source).not.toMatch(/from\s+['"].*persistence[^'"]*['"]/i)
      expect(source).not.toMatch(/from\s+['"]redis['"]/i)
    }
  )
})
