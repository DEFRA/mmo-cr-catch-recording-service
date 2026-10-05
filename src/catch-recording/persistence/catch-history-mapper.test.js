import { toHistoryDocument, toHistoryEvent } from './catch-history-mapper.js'
import {
  CATCH_HISTORY_EVENT_TYPES,
  validateHistoryEventInput
} from './catch-history-event.js'

function validEvent(overrides = {}) {
  return validateHistoryEventInput({
    catchRecordId: 'catch-record-1',
    ownerUserId: 'owner-1',
    eventType: CATCH_HISTORY_EVENT_TYPES.SECTION_SAVED,
    timestamp: '2026-01-01T00:00:00Z',
    actorUserId: 'actor-1',
    metadata: { section: 'vessel' },
    ...overrides
  })
}

function validDocument(overrides = {}) {
  return {
    _id: 'abc123',
    catchRecordId: 'catch-record-1',
    ownerUserId: 'owner-1',
    eventType: CATCH_HISTORY_EVENT_TYPES.SECTION_SAVED,
    timestamp: '2026-01-01T00:00:00Z',
    actorUserId: 'actor-1',
    metadata: { section: 'vessel' },
    ...overrides
  }
}

describe('#catch-history-mapper', () => {
  describe('toHistoryDocument', () => {
    test('Should map every scalar field explicitly', () => {
      const event = validEvent()
      const document = toHistoryDocument(event)

      expect(document).toEqual({
        catchRecordId: event.catchRecordId,
        ownerUserId: event.ownerUserId,
        eventType: event.eventType,
        timestamp: event.timestamp,
        actorUserId: event.actorUserId,
        metadata: event.metadata
      })
    })

    test('Should not set _id', () => {
      const document = toHistoryDocument(validEvent())
      expect(document._id).toBeUndefined()
    })

    test('Should omit metadata entirely when not supplied', () => {
      const document = toHistoryDocument(validEvent({ metadata: undefined }))
      expect(Object.hasOwn(document, 'metadata')).toBe(false)
    })

    test('Should deep-clone metadata, sharing no mutable reference', () => {
      const event = validEvent({ metadata: { section: 'vessel' } })
      const document = toHistoryDocument(event)

      document.metadata.section = 'trip'

      expect(event.metadata.section).toBe('vessel')
    })

    test('Should not mutate the input event', () => {
      const event = validEvent()
      const snapshot = structuredClone(event)

      toHistoryDocument(event)

      expect(event).toEqual(snapshot)
    })
  })

  describe('toHistoryEvent', () => {
    test('Should map a stored document back to a framework-neutral event', () => {
      const document = validDocument()
      const event = toHistoryEvent(document)

      expect(event).toEqual({
        id: 'abc123',
        catchRecordId: document.catchRecordId,
        ownerUserId: document.ownerUserId,
        eventType: document.eventType,
        timestamp: document.timestamp,
        actorUserId: document.actorUserId,
        metadata: document.metadata
      })
    })

    test('Should convert an ObjectId-like _id to its hex string', () => {
      const objectId = { toHexString: () => 'hex-id-value' }
      const event = toHistoryEvent(validDocument({ _id: objectId }))

      expect(event.id).toBe('hex-id-value')
    })

    test('Should exclude the MongoDB _id from the output under its own name', () => {
      const event = toHistoryEvent(validDocument())
      expect(Object.hasOwn(event, '_id')).toBe(false)
    })

    test('Should not leak an unknown stored field into the output', () => {
      const event = toHistoryEvent(
        validDocument({ unapprovedStoredField: 'should-not-leak' })
      )
      expect(event.unapprovedStoredField).toBeUndefined()
    })

    test('Should omit metadata entirely when not stored', () => {
      const document = validDocument({ metadata: undefined })
      delete document.metadata
      const event = toHistoryEvent(document)

      expect(Object.hasOwn(event, 'metadata')).toBe(false)
    })

    test('Should deep-clone stored metadata, sharing no mutable reference', () => {
      const document = validDocument({ metadata: { section: 'vessel' } })
      const event = toHistoryEvent(document)

      event.metadata.section = 'trip'

      expect(document.metadata.section).toBe('vessel')
    })

    test('Should not mutate the stored document', () => {
      const document = validDocument()
      const snapshot = structuredClone({ ...document })

      toHistoryEvent(document)

      expect(document).toEqual(snapshot)
    })

    test('Should reject a non-object document', () => {
      expect(() => toHistoryEvent(null)).toThrow(TypeError)
      expect(() => toHistoryEvent('not-an-object')).toThrow(TypeError)
    })

    test('Should reject a missing/invalid _id', () => {
      expect(() => toHistoryEvent(validDocument({ _id: undefined }))).toThrow(
        TypeError
      )
      expect(() => toHistoryEvent(validDocument({ _id: null }))).toThrow(
        TypeError
      )
    })

    test.each(['catchRecordId', 'ownerUserId', 'timestamp', 'actorUserId'])(
      'Should reject a missing/invalid "%s"',
      (field) => {
        expect(() => toHistoryEvent(validDocument({ [field]: '' }))).toThrow(
          TypeError
        )
        expect(() =>
          toHistoryEvent(validDocument({ [field]: undefined }))
        ).toThrow(TypeError)
      }
    )

    test('Should reject an unsupported stored eventType', () => {
      expect(() =>
        toHistoryEvent(validDocument({ eventType: 'WITHDRAWN' }))
      ).toThrow(TypeError)
    })
  })

  describe('mapping round trip', () => {
    test('Should preserve every field through document -> event -> document', () => {
      const event = validEvent()
      const document = toHistoryDocument(event)
      const roundTrippedEvent = toHistoryEvent({ ...document, _id: 'abc123' })

      expect(roundTrippedEvent).toEqual({ id: 'abc123', ...event })
    })
  })
})
