import { isApplicationError } from '#/common/helpers/errors/application-error.js'

import {
  normalizeBoolean,
  normalizeCalendarDate,
  normalizeDateTime,
  normalizeIdentifier,
  normalizePositiveNumber,
  normalizeText,
  normalizeYesNo
} from './catch-record-primitive-normalizers.js'

function expectRejected(fn) {
  try {
    fn()
    throw new Error('Expected the normaliser to throw')
  } catch (error) {
    expect(isApplicationError(error)).toBe(true)
    expect(error.category).toBe('INVALID_REQUEST')
    return error
  }
}

describe('#normalizeText', () => {
  test('Should trim leading and trailing whitespace', () => {
    expect(normalizeText('  hello  ')).toBe('hello')
  })

  test('Should preserve meaningful internal whitespace', () => {
    expect(normalizeText('hello   world')).toBe('hello   world')
  })

  test('Should preserve case', () => {
    expect(normalizeText('Example Vessel')).toBe('Example Vessel')
  })

  test('Should preserve Unicode text', () => {
    expect(normalizeText('Côte d’Ivoire 🐟')).toBe('Côte d’Ivoire 🐟')
  })

  test('Should normalise an empty string to null when nullable', () => {
    expect(normalizeText('   ', { nullable: true })).toBeNull()
  })

  test('Should reject an empty string when not nullable', () => {
    expectRejected(() => normalizeText('   ', { nullable: false }))
  })

  test('Should accept null when nullable', () => {
    expect(normalizeText(null, { nullable: true })).toBeNull()
  })

  test('Should reject null when not nullable', () => {
    expectRejected(() => normalizeText(null, { nullable: false }))
  })

  test('Should reject a non-string value', () => {
    expectRejected(() => normalizeText(42))
  })
})

describe('#normalizeIdentifier', () => {
  test('Should trim surrounding whitespace', () => {
    expect(normalizeIdentifier(' vessel-1 ')).toBe('vessel-1')
  })

  test('Should reject a non-string identifier', () => {
    expectRejected(() => normalizeIdentifier({}))
  })
})

describe('#normalizeCalendarDate', () => {
  test('Should accept an exact YYYY-MM-DD value', () => {
    expect(normalizeCalendarDate('2026-01-01')).toBe('2026-01-01')
  })

  test.each([
    '01/02/2026',
    '2026/01/01',
    '1-1-2026',
    'not-a-date',
    '2026-13-40'
  ])('Should reject the ambiguous or malformed date "%s"', (value) => {
    expectRejected(() => normalizeCalendarDate(value))
  })

  test('Should accept null when nullable', () => {
    expect(normalizeCalendarDate(null)).toBeNull()
  })
})

describe('#normalizeDateTime', () => {
  test('Should accept a Z-suffixed ISO date-time', () => {
    expect(normalizeDateTime('2026-01-01T09:00:00.000Z')).toBe(
      '2026-01-01T09:00:00.000Z'
    )
  })

  test('Should accept an offset-suffixed ISO date-time', () => {
    expect(normalizeDateTime('2026-01-01T09:00:00+01:00')).toBe(
      '2026-01-01T09:00:00+01:00'
    )
  })

  test.each(['2026-01-01', '01/01/2026 09:00', 'not-a-date-time'])(
    'Should reject the invalid date-time "%s"',
    (value) => {
      expectRejected(() => normalizeDateTime(value))
    }
  )
})

describe('#normalizeBoolean', () => {
  test.each([true, false])('Should preserve the boolean %s', (value) => {
    expect(normalizeBoolean(value)).toBe(value)
  })

  test.each(['true', 'false', 1, 0, 'yes', 'no'])(
    'Should reject the non-boolean value %p (no implicit truthiness)',
    (value) => {
      expectRejected(() => normalizeBoolean(value))
    }
  )

  test('Should accept null when nullable', () => {
    expect(normalizeBoolean(null)).toBeNull()
  })
})

describe('#normalizePositiveNumber', () => {
  test('Should preserve a positive number', () => {
    expect(normalizePositiveNumber(12.5)).toBe(12.5)
  })

  test.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, '12.5'])(
    'Should reject the non-positive-finite-number value %p',
    (value) => {
      expectRejected(() => normalizePositiveNumber(value, { nullable: false }))
    }
  )

  test('Should accept null when nullable', () => {
    expect(normalizePositiveNumber(null)).toBeNull()
  })
})

describe('#normalizeYesNo', () => {
  test.each(['YES', 'NO'])(
    'Should preserve the canonical value "%s"',
    (value) => {
      expect(normalizeYesNo(value)).toBe(value)
    }
  )

  test.each(['yes', 'no', 'Yes', 'MAYBE', ''])(
    'Should reject the unsupported value "%s"',
    (value) => {
      expectRejected(() => normalizeYesNo(value))
    }
  )

  test('Should not convert an empty value to NO', () => {
    const error = expectRejected(() => normalizeYesNo(''))
    expect(error.code).toBe('INVALID_YES_NO_VALUE')
  })
})
