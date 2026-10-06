import { readFileSync } from 'node:fs'

const FRAMEWORK_NEUTRAL_FILES = [
  'validation-result.js',
  'validation-codes.js',
  'structural.js',
  'catch-record.js',
  'sections/gears.js',
  'sections/pair-fishing.js',
  'sections/landing.js',
  'sections/trip.js'
]

describe('#architecture-boundary (validation)', () => {
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
