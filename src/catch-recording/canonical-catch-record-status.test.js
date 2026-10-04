import {
  CATCH_RECORD_STATUS,
  CATCH_RECORD_STATUSES,
  isCatchRecordStatus
} from './canonical-catch-record-status.js'

describe('CATCH_RECORD_STATUS', () => {
  test('Should expose exactly the three approved persisted statuses', () => {
    expect(CATCH_RECORD_STATUS).toEqual({
      DRAFT: 'DRAFT',
      SUBMITTED: 'SUBMITTED',
      COMPLETE: 'COMPLETE'
    })
  })

  test('Should be frozen', () => {
    expect(Object.isFrozen(CATCH_RECORD_STATUS)).toBe(true)
  })

  test('Should not permit a new status to be added', () => {
    expect(() => {
      CATCH_RECORD_STATUS.DRAFT_EDIT = 'DRAFT_EDIT'
    }).toThrow()
    expect(CATCH_RECORD_STATUS.DRAFT_EDIT).toBeUndefined()
  })
})

describe('CATCH_RECORD_STATUSES', () => {
  test('Should contain exactly DRAFT, SUBMITTED and COMPLETE', () => {
    expect(CATCH_RECORD_STATUSES).toEqual(['DRAFT', 'SUBMITTED', 'COMPLETE'])
  })

  test('Should be frozen', () => {
    expect(Object.isFrozen(CATCH_RECORD_STATUSES)).toBe(true)
  })
})

describe('#isCatchRecordStatus', () => {
  test.each(['DRAFT', 'SUBMITTED', 'COMPLETE'])(
    'Should accept the approved status "%s"',
    (status) => {
      expect(isCatchRecordStatus(status)).toBe(true)
    }
  )

  test.each([
    'DRAFT_EDIT',
    'AMENDED',
    'ABANDONED',
    'WITHDRAWN',
    'draft',
    '',
    undefined,
    null,
    42
  ])('Should reject the unsupported status %p', (status) => {
    expect(isCatchRecordStatus(status)).toBe(false)
  })
})
