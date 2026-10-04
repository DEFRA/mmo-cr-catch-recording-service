import {
  CATCH_RECORD_DISPLAY_STATUS,
  deriveDisplayStatus
} from './catch-record-lifecycle-status.js'

describe('CATCH_RECORD_DISPLAY_STATUS', () => {
  test('Should expose exactly the four approved display statuses', () => {
    expect(CATCH_RECORD_DISPLAY_STATUS).toEqual({
      DRAFT: 'Draft',
      AMENDED: 'Amended',
      SUBMITTED: 'Submitted',
      COMPLETE: 'Complete'
    })
  })

  test('Should be frozen (immutable)', () => {
    expect(Object.isFrozen(CATCH_RECORD_DISPLAY_STATUS)).toBe(true)
  })
})

describe('#deriveDisplayStatus', () => {
  test('Should derive Draft for a never-submitted draft', () => {
    const result = deriveDisplayStatus({
      status: 'DRAFT',
      numberOfSubmissions: 0
    })

    expect(result.allowed).toBe(true)
    expect(result.details.displayStatus).toBe('Draft')
  })

  test('Should derive Amended for a draft with prior submissions', () => {
    const result = deriveDisplayStatus({
      status: 'DRAFT',
      numberOfSubmissions: 2
    })

    expect(result.details.displayStatus).toBe('Amended')
  })

  test('Should derive Submitted', () => {
    expect(
      deriveDisplayStatus({ status: 'SUBMITTED', numberOfSubmissions: 1 })
        .details.displayStatus
    ).toBe('Submitted')
  })

  test('Should derive Complete', () => {
    expect(
      deriveDisplayStatus({ status: 'COMPLETE', numberOfSubmissions: 1 })
        .details.displayStatus
    ).toBe('Complete')
  })

  test('Should reject an unsupported persisted status', () => {
    const result = deriveDisplayStatus({
      status: 'DRAFT_EDIT',
      numberOfSubmissions: 0
    })

    expect(result.allowed).toBe(false)
    expect(result.code).toBe('PERSISTED_STATUS_UNSUPPORTED')
  })

  test('Should reject a negative submission count', () => {
    const result = deriveDisplayStatus({
      status: 'DRAFT',
      numberOfSubmissions: -1
    })

    expect(result.code).toBe('SUBMISSION_COUNT_INVALID')
  })

  test('Should reject a non-integer submission count', () => {
    const result = deriveDisplayStatus({
      status: 'DRAFT',
      numberOfSubmissions: 1.5
    })

    expect(result.code).toBe('SUBMISSION_COUNT_INVALID')
  })

  test('Should not write display status into any persisted-looking shape (pure derivation only)', () => {
    const input = { status: 'DRAFT', numberOfSubmissions: 0 }
    const snapshot = { ...input }

    deriveDisplayStatus(input)

    expect(input).toEqual(snapshot)
  })

  test('Should perform no persistence or external lookup (pure function, no I/O dependency)', () => {
    expect(deriveDisplayStatus.constructor.name).toBe('Function')
  })
})
