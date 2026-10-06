import { getTrustedBusinessDate } from './business-date.js'

describe('#getTrustedBusinessDate', () => {
  test('returns YYYY-MM-DD for Europe/London winter time (no DST offset)', () => {
    const now = () => new Date('2026-01-15T23:30:00Z')
    expect(getTrustedBusinessDate({ timezone: 'Europe/London', now })).toBe(
      '2026-01-15'
    )
  })

  test('applies British Summer Time so a late-evening UTC time rolls to the next business date', () => {
    const now = () => new Date('2026-07-15T23:30:00Z')
    expect(getTrustedBusinessDate({ timezone: 'Europe/London', now })).toBe(
      '2026-07-16'
    )
  })

  test('is deterministic for the same inputs', () => {
    const now = () => new Date('2026-03-03T12:00:00Z')
    expect(getTrustedBusinessDate({ timezone: 'Europe/London', now })).toBe(
      getTrustedBusinessDate({ timezone: 'Europe/London', now })
    )
  })

  test('defaults now to the real current time when not supplied', () => {
    expect(getTrustedBusinessDate({ timezone: 'Europe/London' })).toMatch(
      /^\d{4}-\d{2}-\d{2}$/
    )
  })
})
