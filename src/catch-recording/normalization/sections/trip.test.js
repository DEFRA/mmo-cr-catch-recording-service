import { readFileSync } from 'node:fs'

import { normaliseTrip } from './trip.js'

const VALID_INPUT = Object.freeze({
  startedAndFinishedToday: true,
  dateStarted: '2026-10-05',
  dateEnded: '2026-10-05',
  departurePort: Object.freeze({ id: '462e3de0', codeSnapshot: 'DROP-ME' }),
  returnPort: Object.freeze({ id: '462e3de0', codeSnapshot: 'DROP-ME' })
})

describe('#normaliseTrip', () => {
  test('Should normalise a complete trip, dropping port snapshots', () => {
    expect(normaliseTrip(VALID_INPUT)).toEqual({
      startedAndFinishedToday: true,
      dateStarted: '2026-10-05',
      dateEnded: '2026-10-05',
      departurePort: { id: '462e3de0' },
      returnPort: { id: '462e3de0' }
    })
  })

  test('Should trim date values', () => {
    expect(
      normaliseTrip({
        dateStarted: '  2026-10-05  ',
        dateEnded: '  2026-10-06  '
      })
    ).toEqual({
      dateStarted: '2026-10-05',
      dateEnded: '2026-10-06'
    })
  })

  test('Should preserve a partial section (only the properties supplied)', () => {
    expect(normaliseTrip({ startedAndFinishedToday: false })).toEqual({
      startedAndFinishedToday: false
    })
  })

  test('Should preserve explicit null on a nested port', () => {
    expect(normaliseTrip({ departurePort: null })).toEqual({
      departurePort: null
    })
  })

  test('Should pass through a malformed (non-object) trip value unchanged', () => {
    expect(normaliseTrip('not-an-object')).toBe('not-an-object')
    expect(normaliseTrip(['array'])).toEqual(['array'])
  })

  test('Should drop an unknown top-level field', () => {
    expect(
      normaliseTrip({ startedAndFinishedToday: true, unexpected: 'value' })
    ).toEqual({
      startedAndFinishedToday: true
    })
  })

  test('Should preserve undefined and null for the whole section', () => {
    expect(normaliseTrip(undefined)).toBeUndefined()
    expect(normaliseTrip(null)).toBeNull()
  })

  test('Should not mutate the input, including nested ports', () => {
    const result = normaliseTrip(VALID_INPUT)

    expect(VALID_INPUT.departurePort).toEqual({
      id: '462e3de0',
      codeSnapshot: 'DROP-ME'
    })
    expect(result.departurePort).not.toBe(VALID_INPUT.departurePort)
  })

  test('Should produce equivalent output regardless of input key order (determinism)', () => {
    const inOrder = { dateStarted: '2026-10-05', dateEnded: '2026-10-06' }
    const reordered = { dateEnded: '2026-10-06', dateStarted: '2026-10-05' }

    expect(normaliseTrip(inOrder)).toEqual(normaliseTrip(reordered))
  })

  test('Should not import Hapi, Boom, Joi, or MongoDB', () => {
    const source = readFileSync(new URL('./trip.js', import.meta.url), 'utf8')

    expect(source).not.toMatch(/from\s+['"]@hapi\/hapi['"]/)
    expect(source).not.toMatch(/from\s+['"]@hapi\/boom['"]/)
    expect(source).not.toMatch(/from\s+['"]joi['"]/)
    expect(source).not.toMatch(/from\s+['"]mongodb['"]/)
  })
})
