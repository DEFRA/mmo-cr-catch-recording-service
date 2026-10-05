import { readFileSync } from 'node:fs'

import { VALIDATION_CODES } from './validation-codes.js'

describe('#VALIDATION_CODES', () => {
  test('Should define exactly the approved focused catalogue', () => {
    expect(Object.keys(VALIDATION_CODES).sort()).toEqual(
      [
        'REQUIRED',
        'INVALID_STRUCTURE',
        'UNSUPPORTED_VALUE',
        'DUPLICATE_RELATIONSHIP',
        'INVALID_REFERENCE',
        'CONDITIONAL_FIELD_INCONSISTENT'
      ].sort()
    )
  })

  test('Should not allow the catalogue to be mutated', () => {
    expect(() => {
      VALIDATION_CODES.REQUIRED = 'CHANGED'
    }).toThrow()

    expect(() => {
      VALIDATION_CODES.NEW_CODE = 'INVENTED'
    }).toThrow()
  })

  test('Should not import Hapi, Boom, Joi, or MongoDB', () => {
    const source = readFileSync(
      new URL('./validation-codes.js', import.meta.url),
      'utf8'
    )

    expect(source).not.toMatch(/from\s+['"]@hapi\/hapi['"]/)
    expect(source).not.toMatch(/from\s+['"]@hapi\/boom['"]/)
    expect(source).not.toMatch(/from\s+['"]joi['"]/)
    expect(source).not.toMatch(/from\s+['"]mongodb['"]/)
  })
})
