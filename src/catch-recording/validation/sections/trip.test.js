import { readFileSync } from 'node:fs'

import { validateTrip } from './trip.js'

function validTripToday() {
  return {
    startedAndFinishedToday: true,
    departurePort: { id: 'port-1' },
    returnPort: { id: 'port-1' }
  }
}

function validTripManual() {
  return {
    startedAndFinishedToday: false,
    dateStarted: '2026-10-01',
    dateEnded: '2026-10-03',
    departurePort: { id: 'port-1' },
    returnPort: { id: 'port-2' }
  }
}

describe('#validateTrip', () => {
  test('Should accept a valid "started and finished today" trip', () => {
    expect(validateTrip(validTripToday())).toEqual({ valid: true, issues: [] })
  })

  test('Should accept a valid manual-dates trip', () => {
    expect(validateTrip(validTripManual())).toEqual({
      valid: true,
      issues: []
    })
  })

  test('Should reject a missing trip-date decision', () => {
    const { startedAndFinishedToday: _omit, ...trip } = validTripToday()
    const result = validateTrip(trip)

    expect(result.valid).toBe(false)
    expect(result.issues).toContainEqual({
      code: 'REQUIRED',
      path: 'trip.startedAndFinishedToday',
      message: 'A trip-date decision is required'
    })
  })

  test('Should discard-and-recompute semantics: a manual date supplied alongside today is tolerated if well-formed', () => {
    const result = validateTrip({
      ...validTripToday(),
      dateStarted: '2026-10-01'
    })

    expect(result).toEqual({ valid: true, issues: [] })
  })

  test('Should reject a malformed date even when started and finished today', () => {
    const result = validateTrip({
      ...validTripToday(),
      dateStarted: 'not-a-date'
    })

    expect(result.valid).toBe(false)
    expect(result.issues).toContainEqual({
      code: 'INVALID_STRUCTURE',
      path: 'trip.dateStarted',
      message: 'Must be a valid ISO date when present'
    })
  })

  test('Should accept dateStarted/dateEnded explicitly null when started and finished today', () => {
    expect(
      validateTrip({
        ...validTripToday(),
        dateStarted: null,
        dateEnded: null
      })
    ).toEqual({ valid: true, issues: [] })
  })

  test('Should require both dates when not started and finished today', () => {
    const result = validateTrip({
      startedAndFinishedToday: false,
      departurePort: { id: 'port-1' },
      returnPort: { id: 'port-1' }
    })

    expect(result.valid).toBe(false)
    expect(result.issues).toContainEqual({
      code: 'REQUIRED',
      path: 'trip.dateStarted',
      message: 'Required'
    })
    expect(result.issues).toContainEqual({
      code: 'REQUIRED',
      path: 'trip.dateEnded',
      message: 'Required'
    })
  })

  test('Should reject a malformed (non-ISO) date', () => {
    const result = validateTrip({
      ...validTripManual(),
      dateStarted: '01/10/2026'
    })

    expect(result.valid).toBe(false)
    expect(result.issues).toContainEqual({
      code: 'REQUIRED',
      path: 'trip.dateStarted',
      message: 'Required'
    })
  })

  test('Should reject dateEnded before dateStarted', () => {
    const result = validateTrip({
      ...validTripManual(),
      dateStarted: '2026-10-05',
      dateEnded: '2026-10-01'
    })

    expect(result.valid).toBe(false)
    expect(result.issues).toContainEqual({
      code: 'CONDITIONAL_FIELD_INCONSISTENT',
      path: 'trip.dateEnded',
      message: 'Must not be before dateStarted'
    })
  })

  test('Should accept dateStarted equal to dateEnded (single-day manual trip)', () => {
    expect(
      validateTrip({
        ...validTripManual(),
        dateStarted: '2026-10-01',
        dateEnded: '2026-10-01'
      })
    ).toEqual({ valid: true, issues: [] })
  })

  test('Should require a departurePort id', () => {
    const result = validateTrip({
      ...validTripToday(),
      departurePort: {}
    })

    expect(result.valid).toBe(false)
    expect(result.issues).toContainEqual({
      code: 'REQUIRED',
      path: 'trip.departurePort.id',
      message: 'A port id is required'
    })
  })

  test('Should require a returnPort', () => {
    const { returnPort: _omit, ...trip } = validTripToday()
    const result = validateTrip(trip)

    expect(result.valid).toBe(false)
    expect(result.issues).toContainEqual({
      code: 'REQUIRED',
      path: 'trip.returnPort',
      message: 'A port selection is required'
    })
  })

  test('Should treat an absent/malformed trip as valid at this layer (deferred to the structural validator)', () => {
    expect(validateTrip(undefined)).toEqual({ valid: true, issues: [] })
    expect(validateTrip(null)).toEqual({ valid: true, issues: [] })
    expect(validateTrip('trip')).toEqual({ valid: true, issues: [] })
    expect(validateTrip([])).toEqual({ valid: true, issues: [] })
  })

  test('Should not mutate the input', () => {
    const input = Object.freeze(validTripManual())
    expect(() => validateTrip(input)).not.toThrow()
  })

  test('Should not import Hapi, Boom, Joi, or MongoDB', () => {
    const source = readFileSync(new URL('./trip.js', import.meta.url), 'utf8')

    expect(source).not.toMatch(/from\s+['"]@hapi\/hapi['"]/)
    expect(source).not.toMatch(/from\s+['"]@hapi\/boom['"]/)
    expect(source).not.toMatch(/from\s+['"]joi['"]/)
    expect(source).not.toMatch(/from\s+['"]mongodb['"]/)
  })
})
