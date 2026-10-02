import { assertUniqueCollectionNames } from './assert-unique-collection-names.js'

describe('#assertUniqueCollectionNames', () => {
  test('With all unique names, Should not throw', () => {
    expect(() =>
      assertUniqueCollectionNames({
        catchRecords: 'catchRecords',
        catchRecordHistory: 'catchRecordHistory',
        idempotencyRecords: 'idempotencyRecords'
      })
    ).not.toThrow()
  })

  test('With a duplicate name, Should throw deterministically identifying it', () => {
    expect(() =>
      assertUniqueCollectionNames({
        catchRecords: 'sharedName',
        catchRecordHistory: 'sharedName'
      })
    ).toThrow('Duplicate name(s): sharedName')
  })

  test('With multiple duplicate groups, Should identify every duplicate', () => {
    expect(() =>
      assertUniqueCollectionNames({
        a: 'nameOne',
        b: 'nameOne',
        c: 'nameTwo',
        d: 'nameTwo',
        e: 'unique'
      })
    ).toThrow(/nameOne/)
  })

  test('With an empty collections object, Should not throw', () => {
    expect(() => assertUniqueCollectionNames({})).not.toThrow()
  })
})
