import {
  CATCH_RECORD_SERVER_OWNED_FIELDS,
  isServerOwnedField
} from './canonical-catch-record-server-owned-fields.js'

const EXPECTED_FIELDS = [
  'id',
  'catchRecordReference',
  'ownerUserId',
  'status',
  'version',
  'numberOfSubmissions',
  'hasUnsubmittedChanges',
  'audit',
  'artifacts',
  'createdAt',
  'createdBy',
  'updatedAt',
  'updatedBy',
  'submittedAt',
  'submittedBy',
  'completedAt',
  'completedBy'
]

const CLIENT_OWNED_BUSINESS_SECTIONS = [
  'vessel',
  'trip',
  'pairFishing',
  'gear',
  'retainedCatch'
]

describe('CATCH_RECORD_SERVER_OWNED_FIELDS', () => {
  test('Should contain exactly the approved server-owned fields', () => {
    expect(CATCH_RECORD_SERVER_OWNED_FIELDS).toEqual(EXPECTED_FIELDS)
  })

  test('Should be frozen', () => {
    expect(Object.isFrozen(CATCH_RECORD_SERVER_OWNED_FIELDS)).toBe(true)
  })

  test.each(CLIENT_OWNED_BUSINESS_SECTIONS)(
    'Should exclude the client-owned business section "%s"',
    (section) => {
      expect(CATCH_RECORD_SERVER_OWNED_FIELDS).not.toContain(section)
    }
  )
})

describe('#isServerOwnedField', () => {
  test.each(EXPECTED_FIELDS)(
    'Should identify "%s" as server-owned',
    (field) => {
      expect(isServerOwnedField(field)).toBe(true)
    }
  )

  test.each([...CLIENT_OWNED_BUSINESS_SECTIONS, 'unknownField', '', undefined])(
    'Should not identify %p as server-owned',
    (field) => {
      expect(isServerOwnedField(field)).toBe(false)
    }
  )
})
