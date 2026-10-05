import { readFileSync } from 'node:fs'

const FRAMEWORK_NEUTRAL_FILES = [
  'canonical-catch-record.js',
  'lifecycle-status.js',
  'server-owned-fields.js',
  'lifecycle-codes.js',
  'display-status.js',
  'submission-number.js',
  'lifecycle-consistency.js',
  'lifecycle-transitions.js'
]

describe('#architecture-boundary (domain)', () => {
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
})
