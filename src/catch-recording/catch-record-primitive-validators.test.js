import {
  findDuplicateKeys,
  validateBoolean,
  validateCalendarDate,
  validateCollectionLength,
  validateDateTime,
  validateEnum,
  validateIdentifier,
  validateNumber,
  validateOptionalString,
  validateRequiredString
} from './catch-record-primitive-validators.js'

describe('#validateRequiredString', () => {
  test('Should pass for a non-empty string', () => {
    expect(validateRequiredString('hello', 'path')).toEqual([])
  })

  test('Should fail with REQUIRED_FIELD when null', () => {
    expect(validateRequiredString(null, 'path')[0].code).toBe('REQUIRED_FIELD')
  })

  test('Should fail with INVALID_TYPE for a non-string', () => {
    expect(validateRequiredString(42, 'path')[0].code).toBe('INVALID_TYPE')
  })

  test('Should fail with EMPTY_VALUE for a whitespace-only string', () => {
    expect(validateRequiredString('   ', 'path')[0].code).toBe('EMPTY_VALUE')
  })

  test('Should allow an empty string when allowEmpty is true', () => {
    expect(validateRequiredString('', 'path', { allowEmpty: true })).toEqual([])
  })
})

describe('#validateOptionalString', () => {
  test('Should pass for null', () => {
    expect(validateOptionalString(null, 'path')).toEqual([])
  })

  test('Should fail for a non-string', () => {
    expect(validateOptionalString(42, 'path')[0].code).toBe('INVALID_TYPE')
  })
})

describe('#validateIdentifier', () => {
  test('Should pass for a valid identifier', () => {
    expect(validateIdentifier('vessel-1', 'vessel.id')).toEqual([])
  })

  test('Should fail with INVALID_IDENTIFIER for a non-string', () => {
    expect(validateIdentifier(42, 'vessel.id')[0].code).toBe(
      'INVALID_IDENTIFIER'
    )
  })

  test('Should fail with REQUIRED_FIELD when required and missing', () => {
    expect(
      validateIdentifier(null, 'vessel.id', { required: true })[0].code
    ).toBe('REQUIRED_FIELD')
  })
})

describe('#validateBoolean', () => {
  test('Should pass for true/false', () => {
    expect(validateBoolean(true, 'path')).toEqual([])
    expect(validateBoolean(false, 'path')).toEqual([])
  })

  test('Should fail for a non-boolean (no implicit truthiness)', () => {
    expect(validateBoolean('true', 'path')[0].code).toBe('INVALID_BOOLEAN')
  })

  test('Should require a value when required is true', () => {
    expect(validateBoolean(null, 'path', { required: true })[0].code).toBe(
      'REQUIRED_FIELD'
    )
  })
})

describe('#validateEnum', () => {
  test('Should pass for an approved value', () => {
    expect(validateEnum('YES', 'path', ['YES', 'NO'])).toEqual([])
  })

  test('Should fail for an unapproved value without converting it', () => {
    const errors = validateEnum('yes', 'path', ['YES', 'NO'])

    expect(errors[0].code).toBe('INVALID_ENUM_VALUE')
    expect(errors[0].metadata.allowedValues).toEqual(['YES', 'NO'])
  })
})

describe('#validateCalendarDate', () => {
  test('Should pass for a valid YYYY-MM-DD date', () => {
    expect(validateCalendarDate('2026-01-01', 'path')).toEqual([])
  })

  test.each(['01/02/2026', '2026-13-01', 'not-a-date'])(
    'Should reject the malformed date "%s"',
    (value) => {
      expect(validateCalendarDate(value, 'path')[0].code).toBe('INVALID_DATE')
    }
  )
})

describe('#validateDateTime', () => {
  test('Should pass for a valid ISO 8601 timestamp', () => {
    expect(validateDateTime('2026-01-01T09:00:00.000Z', 'path')).toEqual([])
  })

  test('Should reject an invalid timestamp', () => {
    expect(validateDateTime('2026-01-01', 'path')[0].code).toBe(
      'INVALID_TIMESTAMP'
    )
  })
})

describe('#validateNumber', () => {
  test('Should pass for a finite number', () => {
    expect(validateNumber(12.5, 'path')).toEqual([])
  })

  test.each([Number.NaN, Number.POSITIVE_INFINITY, '12.5'])(
    'Should reject the invalid numeric value %p',
    (value) => {
      expect(validateNumber(value, 'path')[0].code).toBe('INVALID_NUMBER')
    }
  )

  test('Should reject a non-positive value when positive is required', () => {
    expect(validateNumber(0, 'path', { positive: true })[0].code).toBe(
      'INVALID_NUMBER'
    )
  })
})

describe('#validateCollectionLength', () => {
  test('Should pass when within bounds', () => {
    expect(
      validateCollectionLength([1, 2], 'gear', { min: 1, max: 5 })
    ).toEqual([])
  })

  test('Should fail with COLLECTION_TOO_SMALL below the minimum', () => {
    expect(validateCollectionLength([], 'gear', { min: 1 })[0].code).toBe(
      'COLLECTION_TOO_SMALL'
    )
  })

  test('Should fail with COLLECTION_TOO_LARGE above the maximum', () => {
    expect(
      validateCollectionLength([1, 2, 3], 'gear', { max: 2 })[0].code
    ).toBe('COLLECTION_TOO_LARGE')
  })

  test('Should not enforce any bound when neither min nor max is supplied', () => {
    expect(
      validateCollectionLength(new Array(1000).fill(1), 'gear', {})
    ).toEqual([])
  })
})

describe('#findDuplicateKeys', () => {
  test('Should find a repeated key', () => {
    expect(
      findDuplicateKeys(
        [{ id: 'a' }, { id: 'b' }, { id: 'a' }],
        (item) => item.id
      )
    ).toEqual(['a'])
  })

  test('Should return an empty array when there are no duplicates', () => {
    expect(
      findDuplicateKeys([{ id: 'a' }, { id: 'b' }], (item) => item.id)
    ).toEqual([])
  })

  test('Should ignore null/undefined keys', () => {
    expect(
      findDuplicateKeys([{ id: null }, { id: null }], (item) => item.id)
    ).toEqual([])
  })

  test('Should not mutate the input array', () => {
    const items = [{ id: 'a' }, { id: 'a' }]
    const snapshot = JSON.parse(JSON.stringify(items))

    findDuplicateKeys(items, (item) => item.id)

    expect(items).toEqual(snapshot)
  })
})
