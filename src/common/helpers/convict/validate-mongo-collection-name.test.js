import { convictValidateMongoCollectionName } from './validate-mongo-collection-name.js'

describe('#convictValidateMongoCollectionName', () => {
  test.each([
    'catchRecords',
    'catchRecordHistory',
    'vessel_gear_favourites',
    'skipper-vessel-associations',
    'fs.chunks',
    'a',
    '_leadingUnderscore'
  ])('With valid collection name "%s", Should not throw', (value) => {
    expect(() =>
      convictValidateMongoCollectionName.validate(value)
    ).not.toThrow()
  })

  test('With an empty name, Should throw', () => {
    expect(() => convictValidateMongoCollectionName.validate('')).toThrow()
  })

  test('With a control character, Should throw', () => {
    expect(() =>
      convictValidateMongoCollectionName.validate('catch\u0000Records')
    ).toThrow()
  })

  test('With a reserved system. prefix, Should throw', () => {
    expect(() =>
      convictValidateMongoCollectionName.validate('system.indexes')
    ).toThrow()
  })

  test('With a reserved System. prefix in a different case, Should throw', () => {
    expect(() =>
      convictValidateMongoCollectionName.validate('System.Profile')
    ).toThrow()
  })

  test('With a leading dot, Should throw', () => {
    expect(() =>
      convictValidateMongoCollectionName.validate('.hidden')
    ).toThrow()
  })

  test('With a leading number, Should throw', () => {
    expect(() =>
      convictValidateMongoCollectionName.validate('1records')
    ).toThrow()
  })

  test('With a dollar sign, Should throw', () => {
    expect(() =>
      convictValidateMongoCollectionName.validate('catch$Records')
    ).toThrow()
  })

  test('With a name containing whitespace, Should throw', () => {
    expect(() =>
      convictValidateMongoCollectionName.validate('catch records')
    ).toThrow()
  })

  test('With a name exceeding the maximum length, Should throw', () => {
    expect(() =>
      convictValidateMongoCollectionName.validate('a'.repeat(121))
    ).toThrow()
  })

  test('With a non-string value, Should throw', () => {
    expect(() => convictValidateMongoCollectionName.validate(42)).toThrow()
  })
})
