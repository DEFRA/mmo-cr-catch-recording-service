import { readFileSync } from 'node:fs'

import { PERSISTED_STATUSES, isPersistedStatus } from './lifecycle-status.js'

describe('#lifecycle-status', () => {
  test('Should define exactly the three approved persisted statuses', () => {
    expect(Object.values(PERSISTED_STATUSES).sort()).toEqual([
      'COMPLETE',
      'DRAFT',
      'SUBMITTED'
    ])
  })

  test.each(['DRAFT', 'SUBMITTED', 'COMPLETE'])(
    'Should recognise %s as a persisted status',
    (status) => {
      expect(isPersistedStatus(status)).toBe(true)
    }
  )

  test.each(['DRAFT_EDIT', 'AMENDED', 'ABANDONED', 'WITHDRAWN'])(
    'Should reject %s as a persisted status',
    (status) => {
      expect(isPersistedStatus(status)).toBe(false)
    }
  )

  test('Should reject a non-string value', () => {
    expect(isPersistedStatus(undefined)).toBe(false)
    expect(isPersistedStatus(null)).toBe(false)
    expect(isPersistedStatus(42)).toBe(false)
  })

  test('Should not allow the catalogue to be mutated', () => {
    expect(() => {
      PERSISTED_STATUSES.DRAFT = 'CHANGED'
    }).toThrow()

    expect(() => {
      PERSISTED_STATUSES.NEW_STATUS = 'INVENTED'
    }).toThrow()
  })

  test('Should not import Hapi, Boom, Joi, or MongoDB', () => {
    const source = readFileSync(
      new URL('./lifecycle-status.js', import.meta.url),
      'utf8'
    )

    expect(source).not.toMatch(/from\s+['"]@hapi\/hapi['"]/)
    expect(source).not.toMatch(/from\s+['"]@hapi\/boom['"]/)
    expect(source).not.toMatch(/from\s+['"]joi['"]/)
    expect(source).not.toMatch(/from\s+['"]mongodb['"]/)
  })
})
