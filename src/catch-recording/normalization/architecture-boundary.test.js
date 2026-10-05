import { readFileSync } from 'node:fs'

const FRAMEWORK_NEUTRAL_FILES = [
  'primitives.js',
  'object-helpers.js',
  'catch-record.js',
  'sections/vessel.js',
  'sections/trip.js',
  'sections/pair-fishing.js',
  'sections/gears.js',
  'sections/landing.js'
]

describe('#architecture-boundary (normalization)', () => {
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
