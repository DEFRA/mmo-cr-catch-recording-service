import {
  assertAllowedChanges,
  assertPlainString,
  assertSafeListLimit,
  assertSectionChanges
} from './persistence-guards.js'

describe('#persistence-guards', () => {
  describe('assertPlainString', () => {
    test('Should accept a non-empty string', () => {
      expect(() => assertPlainString('abc-123', 'id')).not.toThrow()
    })

    test('Should reject an empty string', () => {
      expect(() => assertPlainString('', 'id')).toThrow(TypeError)
    })

    test('Should reject undefined and null', () => {
      expect(() => assertPlainString(undefined, 'id')).toThrow(TypeError)
      expect(() => assertPlainString(null, 'id')).toThrow(TypeError)
    })

    test('Should reject a number', () => {
      expect(() => assertPlainString(42, 'id')).toThrow(TypeError)
    })

    test('Should reject an operator-injection object', () => {
      expect(() => assertPlainString({ $ne: null }, 'ownerUserId')).toThrow(
        TypeError
      )
    })

    test('Should reject a regular-expression-shaped object', () => {
      expect(() =>
        assertPlainString({ $regex: '.*' }, 'catchRecordReference')
      ).toThrow(TypeError)
    })

    test('Should reject an array', () => {
      expect(() => assertPlainString(['a'], 'id')).toThrow(TypeError)
    })
  })

  describe('assertSafeListLimit', () => {
    test('Should accept an integer within the bound', () => {
      expect(() => assertSafeListLimit(20, 100)).not.toThrow()
      expect(() => assertSafeListLimit(100, 100)).not.toThrow()
    })

    test('Should reject zero, negative, or non-integer values', () => {
      expect(() => assertSafeListLimit(0, 100)).toThrow(TypeError)
      expect(() => assertSafeListLimit(-1, 100)).toThrow(TypeError)
      expect(() => assertSafeListLimit(1.5, 100)).toThrow(TypeError)
      expect(() => assertSafeListLimit('20', 100)).toThrow(TypeError)
      expect(() => assertSafeListLimit(undefined, 100)).toThrow(TypeError)
    })

    test('Should reject a value exceeding the ceiling', () => {
      expect(() => assertSafeListLimit(101, 100)).toThrow(TypeError)
    })
  })

  describe('assertAllowedChanges', () => {
    const allowedFields = ['updatedAt', 'updatedBy']

    test('Should accept a changes object using only allowed string fields', () => {
      expect(() =>
        assertAllowedChanges(
          { updatedAt: '2026-01-01T00:00:00Z', updatedBy: 'user-1' },
          allowedFields
        )
      ).not.toThrow()
    })

    test('Should accept a subset of the allowed fields', () => {
      expect(() =>
        assertAllowedChanges(
          { updatedAt: '2026-01-01T00:00:00Z' },
          allowedFields
        )
      ).not.toThrow()
    })

    test('Should reject a non-object changes value', () => {
      expect(() => assertAllowedChanges(null, allowedFields)).toThrow(TypeError)
      expect(() => assertAllowedChanges('abc', allowedFields)).toThrow(
        TypeError
      )
      expect(() => assertAllowedChanges(['abc'], allowedFields)).toThrow(
        TypeError
      )
    })

    test('Should reject an empty changes object', () => {
      expect(() => assertAllowedChanges({}, allowedFields)).toThrow(TypeError)
    })

    test('Should reject a server-owned field not on the allow-list', () => {
      expect(() =>
        assertAllowedChanges(
          { updatedAt: '2026-01-01T00:00:00Z', version: 99 },
          allowedFields
        )
      ).toThrow(TypeError)
      expect(() =>
        assertAllowedChanges({ status: 'SUBMITTED' }, allowedFields)
      ).toThrow(TypeError)
    })

    test('Should reject a raw MongoDB update operator key', () => {
      expect(() =>
        assertAllowedChanges({ $set: { updatedAt: 'x' } }, allowedFields)
      ).toThrow(TypeError)
    })

    test('Should reject prototype-pollution-shaped keys defensively', () => {
      // Using computed-property syntax so `__proto__` becomes a real own enumerable key rather than
      // JavaScript's special "set the prototype" object-literal behaviour.
      const pollutionAttempt = { ['__proto__']: 'polluted', updatedAt: 'x' }

      expect(() =>
        assertAllowedChanges(pollutionAttempt, allowedFields)
      ).toThrow(TypeError)
      expect(() =>
        assertAllowedChanges({ constructor: 'x' }, allowedFields)
      ).toThrow(TypeError)
    })

    test('Should reject a non-string value for an allowed field', () => {
      expect(() =>
        assertAllowedChanges({ updatedAt: 12345 }, allowedFields)
      ).toThrow(TypeError)
    })
  })

  describe('assertSectionChanges', () => {
    const allowedSectionFields = ['trip', 'pairFishing']
    const validChanges = {
      updatedAt: '2026-10-06T00:00:00.000Z',
      updatedBy: 'user-1',
      trip: { startedAndFinishedToday: true }
    }

    test('Should accept audit metadata plus exactly one allowed, object-valued section field', () => {
      expect(() =>
        assertSectionChanges(validChanges, allowedSectionFields)
      ).not.toThrow()
    })

    test('Should reject a non-plain-object changes value', () => {
      expect(() => assertSectionChanges(null, allowedSectionFields)).toThrow(
        TypeError
      )
      expect(() => assertSectionChanges('trip', allowedSectionFields)).toThrow(
        TypeError
      )
      expect(() => assertSectionChanges([], allowedSectionFields)).toThrow(
        TypeError
      )
    })

    test.each(['updatedAt', 'updatedBy'])(
      'Should reject changes missing the required "%s" audit field',
      (missingField) => {
        const { [missingField]: _omit, ...withoutField } = validChanges
        expect(() =>
          assertSectionChanges(withoutField, allowedSectionFields)
        ).toThrow(TypeError)
      }
    )

    test('Should reject a non-string audit field value', () => {
      expect(() =>
        assertSectionChanges(
          { ...validChanges, updatedAt: 12345 },
          allowedSectionFields
        )
      ).toThrow(TypeError)
    })

    test('Should reject changes with no section field at all', () => {
      const { trip: _omit, ...withoutSection } = validChanges
      expect(() =>
        assertSectionChanges(withoutSection, allowedSectionFields)
      ).toThrow(TypeError)
    })

    test('Should reject changes with more than one section field', () => {
      expect(() =>
        assertSectionChanges(
          { ...validChanges, pairFishing: { enabled: false } },
          allowedSectionFields
        )
      ).toThrow(TypeError)
    })

    test('Should reject a section field that is not on the allow-list', () => {
      expect(() =>
        assertSectionChanges(
          {
            updatedAt: validChanges.updatedAt,
            updatedBy: validChanges.updatedBy,
            gears: []
          },
          allowedSectionFields
        )
      ).toThrow(TypeError)
    })

    test.each(['__proto__', 'constructor', 'prototype'])(
      'Should reject a prototype-pollution-shaped section key "%s"',
      (pollutingKey) => {
        const changes = {
          updatedAt: validChanges.updatedAt,
          updatedBy: validChanges.updatedBy,
          [pollutingKey]: { polluted: true }
        }
        expect(() =>
          assertSectionChanges(changes, [...allowedSectionFields, pollutingKey])
        ).toThrow(TypeError)
      }
    )

    test('Should reject a non-object section value (scalar)', () => {
      expect(() =>
        assertSectionChanges(
          {
            updatedAt: validChanges.updatedAt,
            updatedBy: validChanges.updatedBy,
            trip: 'not-an-object'
          },
          allowedSectionFields
        )
      ).toThrow(TypeError)
    })

    test('Should reject a non-object section value (array)', () => {
      expect(() =>
        assertSectionChanges(
          {
            updatedAt: validChanges.updatedAt,
            updatedBy: validChanges.updatedBy,
            trip: []
          },
          allowedSectionFields
        )
      ).toThrow(TypeError)
    })
  })
})
