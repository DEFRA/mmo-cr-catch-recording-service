import { readFileSync } from 'node:fs'

import {
  SERVER_OWNED_FIELDS,
  isServerOwnedField
} from './server-owned-fields.js'

describe('#server-owned-fields', () => {
  test.each([
    'schemaVersion',
    'id',
    'catchRecordReference',
    'ownerUserId',
    'status',
    'version',
    'numberOfSubmissions',
    'hasUnsubmittedChanges',
    'artifacts',
    'createdAt',
    'createdBy',
    'updatedAt',
    'updatedBy',
    'submittedAt',
    'submittedBy',
    'completedAt',
    'completedBy'
  ])('Should classify %s as server-owned', (field) => {
    expect(isServerOwnedField(field)).toBe(true)
    expect(SERVER_OWNED_FIELDS).toContain(field)
  })

  test.each(['vessel', 'trip', 'pairFishing', 'gears', 'landing'])(
    'Should not classify %s as server-owned',
    (field) => {
      expect(isServerOwnedField(field)).toBe(false)
    }
  )

  test('Should reject a non-string value', () => {
    expect(isServerOwnedField(undefined)).toBe(false)
    expect(isServerOwnedField(null)).toBe(false)
    expect(isServerOwnedField(42)).toBe(false)
  })

  test('Should not allow the catalogue to be mutated', () => {
    expect(() => {
      SERVER_OWNED_FIELDS.push('injectedField')
    }).toThrow()
  })

  test('Should not import Hapi, Boom, Joi, or MongoDB', () => {
    const source = readFileSync(
      new URL('./server-owned-fields.js', import.meta.url),
      'utf8'
    )

    expect(source).not.toMatch(/from\s+['"]@hapi\/hapi['"]/)
    expect(source).not.toMatch(/from\s+['"]@hapi\/boom['"]/)
    expect(source).not.toMatch(/from\s+['"]joi['"]/)
    expect(source).not.toMatch(/from\s+['"]mongodb['"]/)
  })
})
