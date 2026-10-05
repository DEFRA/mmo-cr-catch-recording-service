import { readFileSync } from 'node:fs'

import { LIFECYCLE_CODES } from './lifecycle-codes.js'

describe('#LIFECYCLE_CODES', () => {
  test('Should define exactly the approved two codes', () => {
    expect(Object.keys(LIFECYCLE_CODES).sort()).toEqual([
      'INCONSISTENT_STATE',
      'INELIGIBLE_TRANSITION'
    ])
  })

  test('Should not allow the catalogue to be mutated', () => {
    expect(() => {
      LIFECYCLE_CODES.INELIGIBLE_TRANSITION = 'CHANGED'
    }).toThrow()

    expect(() => {
      LIFECYCLE_CODES.NEW_CODE = 'INVENTED'
    }).toThrow()
  })

  test('Should not import Hapi, Boom, Joi, or MongoDB', () => {
    const source = readFileSync(
      new URL('./lifecycle-codes.js', import.meta.url),
      'utf8'
    )

    expect(source).not.toMatch(/from\s+['"]@hapi\/hapi['"]/)
    expect(source).not.toMatch(/from\s+['"]@hapi\/boom['"]/)
    expect(source).not.toMatch(/from\s+['"]joi['"]/)
    expect(source).not.toMatch(/from\s+['"]mongodb['"]/)
  })
})
