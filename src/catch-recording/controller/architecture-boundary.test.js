import { readFileSync } from 'node:fs'

const FRAMEWORK_NEUTRAL_FILES = [
  'authentication-errors.js',
  'authentication-client.js',
  'authentication-context.js'
]

describe('#architecture-boundary (controller authentication)', () => {
  test.each(FRAMEWORK_NEUTRAL_FILES)(
    '%s should not import Hapi, Boom, or MongoDB',
    (fileName) => {
      const source = readFileSync(
        new URL(`./${fileName}`, import.meta.url),
        'utf8'
      )

      expect(source).not.toMatch(/from\s+['"]@hapi\/hapi['"]/)
      expect(source).not.toMatch(/from\s+['"]@hapi\/boom['"]/)
      expect(source).not.toMatch(/from\s+['"]mongodb['"]/)
    }
  )
})
