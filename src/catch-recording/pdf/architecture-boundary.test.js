import { readFileSync } from 'node:fs'

const FRAMEWORK_NEUTRAL_FILES = ['pdf-generator.js']

describe('#architecture-boundary (pdf)', () => {
  test.each(FRAMEWORK_NEUTRAL_FILES)(
    '%s should not import Hapi, Boom, Joi, MongoDB, or the AWS SDK',
    (fileName) => {
      const source = readFileSync(
        new URL(`./${fileName}`, import.meta.url),
        'utf8'
      )

      expect(source).not.toMatch(/from\s+['"]@hapi\/hapi['"]/)
      expect(source).not.toMatch(/from\s+['"]@hapi\/boom['"]/)
      expect(source).not.toMatch(/from\s+['"]joi['"]/)
      expect(source).not.toMatch(/from\s+['"]mongodb['"]/)
      expect(source).not.toMatch(/from\s+['"]@aws-sdk\//)
    }
  )
})
