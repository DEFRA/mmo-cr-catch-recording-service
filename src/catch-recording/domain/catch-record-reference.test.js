import {
  normaliseVesselRss,
  formatBusinessDateTime,
  generateCatchRecordReference,
  MAX_REFERENCE_GENERATION_ATTEMPTS
} from './catch-record-reference.js'
import { isApplicationError } from '#/common/helpers/errors/application-error.js'

describe('#normaliseVesselRss', () => {
  test('uppercases and strips non-alphanumeric characters', () => {
    expect(normaliseVesselRss('ab 123-xy')).toBe('AB123XY')
  })

  test('is idempotent for an already-normalised value', () => {
    expect(normaliseVesselRss('AB123XY')).toBe('AB123XY')
  })

  test.each([undefined, null, 123, {}, []])(
    'rejects a non-string RSS (%p)',
    (value) => {
      expect(() => normaliseVesselRss(value)).toThrow(expect.any(Error))
      try {
        normaliseVesselRss(value)
      } catch (error) {
        expect(isApplicationError(error)).toBe(true)
        expect(error.category).toBe('BUSINESS_VALIDATION_FAILURE')
        expect(error.code).toBe('VESSEL_RSS_MISSING')
      }
    }
  )

  test('rejects an empty string', () => {
    expect(() => normaliseVesselRss('')).toThrow(expect.any(Error))
  })

  test('rejects a string that normalises to nothing', () => {
    expect(() => normaliseVesselRss('   --- ')).toThrow(expect.any(Error))
  })

  test('never leaks the raw rejected value in the message', () => {
    try {
      normaliseVesselRss(null)
    } catch (error) {
      expect(error.message).not.toContain('null')
    }
  })
})

describe('#formatBusinessDateTime', () => {
  test('formats a UTC date within Europe/London winter time (no DST offset)', () => {
    const date = new Date('2026-01-15T09:30:45Z')
    expect(formatBusinessDateTime(date, 'Europe/London')).toEqual({
      datePart: '150126',
      timePart: '093045'
    })
  })

  test('applies British Summer Time (+1 hour) in Europe/London', () => {
    const date = new Date('2026-07-15T09:30:45Z')
    expect(formatBusinessDateTime(date, 'Europe/London')).toEqual({
      datePart: '150726',
      timePart: '103045'
    })
  })

  test('formats midnight as 00, not 24', () => {
    const date = new Date('2026-01-15T00:00:00Z')
    expect(formatBusinessDateTime(date, 'Europe/London')).toEqual({
      datePart: '150126',
      timePart: '000000'
    })
  })

  test('is deterministic for the same inputs', () => {
    const date = new Date('2026-03-03T12:00:00Z')
    expect(formatBusinessDateTime(date, 'Europe/London')).toEqual(
      formatBusinessDateTime(date, 'Europe/London')
    )
  })
})

describe('#generateCatchRecordReference', () => {
  const fixedNow = () => new Date('2026-01-15T09:30:45Z')

  test('generates the approved GBR-{RSS}-{DDMMYY}-{HHMMSS} format', async () => {
    const reference = await generateCatchRecordReference({
      rss: 'ab123xy',
      timezone: 'Europe/London',
      now: fixedNow,
      referenceExists: async () => false
    })

    expect(reference).toBe('GBR-AB123XY-150126-093045')
  })

  test('is deterministic under controlled test inputs', async () => {
    const generate = () =>
      generateCatchRecordReference({
        rss: 'ab123xy',
        timezone: 'Europe/London',
        now: fixedNow,
        referenceExists: async () => false
      })

    expect(await generate()).toBe(await generate())
  })

  test('regenerates against the next second on a single collision', async () => {
    let callCount = 0
    const reference = await generateCatchRecordReference({
      rss: 'ab123xy',
      timezone: 'Europe/London',
      now: fixedNow,
      referenceExists: async () => {
        callCount += 1
        return callCount === 1
      }
    })

    expect(reference).toBe('GBR-AB123XY-150126-093046')
    expect(callCount).toBe(2)
  })

  test('throws a safe DUPLICATE_RESOURCE error after exhausting bounded retries', async () => {
    const referenceExists = async () => true

    await expect(
      generateCatchRecordReference({
        rss: 'ab123xy',
        timezone: 'Europe/London',
        now: fixedNow,
        referenceExists
      })
    ).rejects.toMatchObject({
      category: 'DUPLICATE_RESOURCE',
      code: 'CATCH_RECORD_REFERENCE_GENERATION_FAILED'
    })
  })

  test('respects a caller-supplied maxAttempts bound', async () => {
    let callCount = 0
    await expect(
      generateCatchRecordReference({
        rss: 'ab123xy',
        timezone: 'Europe/London',
        now: fixedNow,
        maxAttempts: 2,
        referenceExists: async () => {
          callCount += 1
          return true
        }
      })
    ).rejects.toMatchObject({
      code: 'CATCH_RECORD_REFERENCE_GENERATION_FAILED'
    })

    expect(callCount).toBe(2)
  })

  test('rejects a missing/malformed vessel RSS before ever calling referenceExists', async () => {
    const referenceExists = vi.fn(async () => false)

    await expect(
      generateCatchRecordReference({
        rss: null,
        timezone: 'Europe/London',
        now: fixedNow,
        referenceExists
      })
    ).rejects.toMatchObject({ code: 'VESSEL_RSS_MISSING' })

    expect(referenceExists).not.toHaveBeenCalled()
  })

  test('exports the approved bounded attempt ceiling', () => {
    expect(MAX_REFERENCE_GENERATION_ATTEMPTS).toBe(5)
  })
})
