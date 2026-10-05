import { readFileSync } from 'node:fs'

const FRAMEWORK_NEUTRAL_FILES = [
  'error-categories.js',
  'application-error.js',
  'sanitise-details.js',
  'http-error-mapper.js'
]

describe('#architecture-boundary', () => {
  test.each(FRAMEWORK_NEUTRAL_FILES)(
    '%s should not import Hapi or Boom',
    (fileName) => {
      const source = readFileSync(
        new URL(`./${fileName}`, import.meta.url),
        'utf8'
      )

      expect(source).not.toMatch(/from\s+['"]@hapi\/hapi['"]/)
      expect(source).not.toMatch(/from\s+['"]@hapi\/boom['"]/)
    }
  )
})
