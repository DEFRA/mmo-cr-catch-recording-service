import {
  CATCH_HISTORY_EVENT_TYPES,
  isSupportedHistoryEventType,
  assertSafeHistoryMetadata,
  validateHistoryEventInput
} from './catch-history-event.js'

function validInput(overrides = {}) {
  return {
    catchRecordId: 'catch-record-1',
    ownerUserId: 'owner-1',
    eventType: CATCH_HISTORY_EVENT_TYPES.DRAFT_CREATED,
    timestamp: '2026-01-01T00:00:00Z',
    actorUserId: 'actor-1',
    ...overrides
  }
}

describe('#catch-history-event', () => {
  describe('CATCH_HISTORY_EVENT_TYPES', () => {
    test('Should expose exactly the eight approved stable event types', () => {
      expect(Object.values(CATCH_HISTORY_EVENT_TYPES).sort()).toEqual(
        [
          'AMENDMENT_SECTION_SAVED',
          'COMPLETED',
          'DRAFT_ABANDONED',
          'DRAFT_CREATED',
          'EDIT_STARTED',
          'RESUBMITTED',
          'SECTION_SAVED',
          'SUBMITTED'
        ].sort()
      )
    })

    test('Should be frozen', () => {
      expect(Object.isFrozen(CATCH_HISTORY_EVENT_TYPES)).toBe(true)
    })
  })

  describe('isSupportedHistoryEventType', () => {
    test.each(Object.values(CATCH_HISTORY_EVENT_TYPES))(
      'Should accept the approved type %s',
      (eventType) => {
        expect(isSupportedHistoryEventType(eventType)).toBe(true)
      }
    )

    test('Should reject an unsupported event type', () => {
      expect(isSupportedHistoryEventType('WITHDRAWN')).toBe(false)
    })

    test('Should reject a non-string value', () => {
      expect(isSupportedHistoryEventType(123)).toBe(false)
      expect(isSupportedHistoryEventType(null)).toBe(false)
      expect(isSupportedHistoryEventType(undefined)).toBe(false)
    })
  })

  describe('validateHistoryEventInput', () => {
    test('Should accept a valid approved event and return every required field', () => {
      const input = validInput()
      const result = validateHistoryEventInput(input)

      expect(result).toEqual(input)
    })

    test('Should return a frozen, independent object', () => {
      const result = validateHistoryEventInput(validInput())

      expect(Object.isFrozen(result)).toBe(true)
      expect(() => {
        result.catchRecordId = 'tampered'
      }).toThrow()
    })

    test('Should not mutate the caller-supplied input', () => {
      const input = validInput({ metadata: { section: 'vessel' } })
      const snapshot = structuredClone(input)

      validateHistoryEventInput(input)

      expect(input).toEqual(snapshot)
    })

    test('Should reject a non-object input', () => {
      expect(() => validateHistoryEventInput(null)).toThrow(TypeError)
      expect(() => validateHistoryEventInput('not-an-object')).toThrow(
        TypeError
      )
      expect(() => validateHistoryEventInput([])).toThrow(TypeError)
    })

    test('Should require catchRecordId', () => {
      expect(() =>
        validateHistoryEventInput(validInput({ catchRecordId: undefined }))
      ).toThrow(TypeError)
      expect(() =>
        validateHistoryEventInput(validInput({ catchRecordId: '' }))
      ).toThrow(TypeError)
    })

    test('Should require ownerUserId', () => {
      expect(() =>
        validateHistoryEventInput(validInput({ ownerUserId: undefined }))
      ).toThrow(TypeError)
    })

    test('Should require actorUserId', () => {
      expect(() =>
        validateHistoryEventInput(validInput({ actorUserId: undefined }))
      ).toThrow(TypeError)
    })

    test('Should reject an operator-shaped id value', () => {
      expect(() =>
        validateHistoryEventInput(validInput({ catchRecordId: { $ne: null } }))
      ).toThrow(TypeError)
    })

    test('Should reject an unsupported event type', () => {
      expect(() =>
        validateHistoryEventInput(validInput({ eventType: 'WITHDRAWN' }))
      ).toThrow(TypeError)
    })

    test('Should reject a missing event type', () => {
      expect(() =>
        validateHistoryEventInput(validInput({ eventType: undefined }))
      ).toThrow(TypeError)
    })

    test('Should reject a missing timestamp', () => {
      expect(() =>
        validateHistoryEventInput(validInput({ timestamp: undefined }))
      ).toThrow(TypeError)
    })

    test.each([
      '2026-01-01',
      '2026-01-01 00:00:00',
      '2026-01-01T00:00:00+01:00',
      '2026-01-01T00:00:00',
      'not-a-timestamp',
      '2026-13-40T00:00:00Z'
    ])('Should reject an invalid timestamp "%s"', (timestamp) => {
      expect(() =>
        validateHistoryEventInput(validInput({ timestamp }))
      ).toThrow(TypeError)
    })

    test('Should accept a timestamp with milliseconds', () => {
      const input = validInput({ timestamp: '2026-01-01T00:00:00.123Z' })
      expect(validateHistoryEventInput(input).timestamp).toBe(
        '2026-01-01T00:00:00.123Z'
      )
    })

    test('Should accept an event with no metadata', () => {
      const result = validateHistoryEventInput(validInput())
      expect(result.metadata).toBeUndefined()
    })

    test('Should accept approved metadata', () => {
      const result = validateHistoryEventInput(
        validInput({ metadata: { section: 'vessel', submissionNumber: 2 } })
      )
      expect(result.metadata).toEqual({
        section: 'vessel',
        submissionNumber: 2
      })
    })

    test('Should exclude unknown top-level fields from the returned event', () => {
      const result = validateHistoryEventInput(
        validInput({ unknownField: 'should-not-appear' })
      )
      expect(result.unknownField).toBeUndefined()
    })
  })

  describe('assertSafeHistoryMetadata', () => {
    test('Should return undefined when no metadata is supplied', () => {
      expect(assertSafeHistoryMetadata(undefined)).toBeUndefined()
    })

    test('Should accept an empty object', () => {
      expect(assertSafeHistoryMetadata({})).toEqual({})
    })

    test.each([
      'vessel',
      'trip',
      'pairFishing',
      'gears',
      'landing',
      'artifacts'
    ])('Should accept the approved section name %s', (section) => {
      expect(assertSafeHistoryMetadata({ section })).toEqual({ section })
    })

    test('Should reject a section name outside the approved canonical list', () => {
      expect(() =>
        assertSafeHistoryMetadata({ section: 'notASection' })
      ).toThrow(TypeError)
    })

    test('Should reject an oversized/bogus section string', () => {
      expect(() =>
        assertSafeHistoryMetadata({ section: 'x'.repeat(10000) })
      ).toThrow(TypeError)
    })

    test('Should accept a valid submissionNumber', () => {
      expect(assertSafeHistoryMetadata({ submissionNumber: 3 })).toEqual({
        submissionNumber: 3
      })
    })

    test.each([0, -1, 1.5, 1001, 'not-a-number', null])(
      'Should reject an invalid submissionNumber %s',
      (submissionNumber) => {
        expect(() => assertSafeHistoryMetadata({ submissionNumber })).toThrow(
          TypeError
        )
      }
    )

    test('Should reject metadata that is not a plain object', () => {
      expect(() => assertSafeHistoryMetadata('not-an-object')).toThrow(
        TypeError
      )
      expect(() => assertSafeHistoryMetadata(null)).toThrow(TypeError)
      expect(() => assertSafeHistoryMetadata([])).toThrow(TypeError)
      expect(() => assertSafeHistoryMetadata(123)).toThrow(TypeError)
    })

    test('Should reject a complete Catch Record mistakenly supplied as metadata', () => {
      expect(() =>
        assertSafeHistoryMetadata({
          id: 'catch-record-1',
          vessel: { name: 'The Example' },
          gears: [],
          status: 'DRAFT'
        })
      ).toThrow(TypeError)
    })

    test('Should reject an artifact-body-like value', () => {
      expect(() =>
        assertSafeHistoryMetadata({ artifactBody: 'base64-pdf-content' })
      ).toThrow(TypeError)
    })

    test('Should reject a credential/token-like key', () => {
      expect(() => assertSafeHistoryMetadata({ token: 'secret' })).toThrow(
        TypeError
      )
      expect(() =>
        assertSafeHistoryMetadata({ authorization: 'Bearer abc' })
      ).toThrow(TypeError)
    })

    test('Should reject prototype-pollution-shaped keys', () => {
      const payload = JSON.parse('{"__proto__": {"polluted": true}}')
      expect(() => assertSafeHistoryMetadata(payload)).toThrow(TypeError)
      expect(() => assertSafeHistoryMetadata({ constructor: 'x' })).toThrow(
        TypeError
      )
      expect(() => assertSafeHistoryMetadata({ prototype: 'x' })).toThrow(
        TypeError
      )
    })

    test('Should reject a nested arbitrary structure under an approved key', () => {
      expect(() =>
        assertSafeHistoryMetadata({ section: { nested: true } })
      ).toThrow(TypeError)
    })

    test('Should not mutate the caller-supplied metadata object', () => {
      const metadata = { section: 'vessel' }
      const snapshot = structuredClone(metadata)

      assertSafeHistoryMetadata(metadata)

      expect(metadata).toEqual(snapshot)
    })

    test('Should return a metadata object with no shared mutable reference to the input', () => {
      const metadata = { section: 'vessel' }
      const safeMetadata = assertSafeHistoryMetadata(metadata)

      safeMetadata.section = 'trip'

      expect(metadata.section).toBe('vessel')
    })
  })
})
