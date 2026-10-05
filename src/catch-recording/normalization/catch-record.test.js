import { readFileSync } from 'node:fs'

import { normaliseCatchRecord } from './catch-record.js'
import { newDraftExample } from '../domain/__fixtures__/canonical-catch-record.fixtures.js'

function clientPayloadFrom(fixture) {
  // Simulates what an untrusted client might send: the client-owned sections, plus an attempt to
  // override every server-owned root field.
  return {
    vessel: fixture.vessel,
    trip: fixture.trip,
    pairFishing: fixture.pairFishing,
    gears: fixture.gears,
    landing: fixture.landing,
    // Attempted server-owned-field overrides - none of these must reach output.
    schemaVersion: 999,
    id: 'attacker-supplied-id',
    catchRecordReference: 'ATTACKER-REF',
    ownerUserId: 'attacker-user-id',
    status: 'COMPLETE',
    version: 999,
    numberOfSubmissions: 999,
    hasUnsubmittedChanges: true,
    artifacts: [{ submissionNumber: 1, type: 'JSON_SNAPSHOT' }],
    createdAt: 'attacker-timestamp',
    createdBy: 'attacker-id',
    updatedAt: 'attacker-timestamp',
    updatedBy: 'attacker-id',
    submittedAt: 'attacker-timestamp',
    submittedBy: 'attacker-id',
    completedAt: 'attacker-timestamp',
    completedBy: 'attacker-id'
  }
}

describe('#normaliseCatchRecord', () => {
  test('Should compose all approved sections from a realistic client payload', () => {
    const payload = clientPayloadFrom(newDraftExample)
    const result = normaliseCatchRecord(payload)

    expect(result).toHaveProperty('vessel')
    expect(result).toHaveProperty('trip')
    expect(result).toHaveProperty('pairFishing')
    expect(result).toHaveProperty('gears')
    expect(result).toHaveProperty('landing')
    expect(result.vessel).toEqual({ id: newDraftExample.vessel.id })
  })

  test.each([
    'schemaVersion',
    'id',
    'catchRecordReference',
    'ownerUserId',
    'status',
    'version',
    'numberOfSubmissions',
    'hasUnsubmittedChanges',
    'artifacts',
    'createdAt',
    'createdBy',
    'updatedAt',
    'updatedBy',
    'submittedAt',
    'submittedBy',
    'completedAt',
    'completedBy'
  ])('Should never let an attempted %s override reach output', (field) => {
    const payload = clientPayloadFrom(newDraftExample)
    const result = normaliseCatchRecord(payload)

    expect(result).not.toHaveProperty(field)
  })

  test('Should never produce a root-level statistical area or species collection', () => {
    const result = normaliseCatchRecord(clientPayloadFrom(newDraftExample))

    expect(result).not.toHaveProperty('statisticalArea')
    expect(result).not.toHaveProperty('speciesCaught')
  })

  test('Should leave a genuinely absent section absent from output', () => {
    expect(normaliseCatchRecord({ vessel: { id: 'abc' } })).toEqual({
      vessel: { id: 'abc' }
    })
  })

  test('Should drop an unknown top-level field', () => {
    expect(
      normaliseCatchRecord({ vessel: { id: 'abc' }, unexpected: 'value' })
    ).toEqual({
      vessel: { id: 'abc' }
    })
  })

  test('Should preserve undefined and null for the whole payload', () => {
    expect(normaliseCatchRecord(undefined)).toBeUndefined()
    expect(normaliseCatchRecord(null)).toBeNull()
  })

  test('Should pass through a malformed (non-object) payload unchanged', () => {
    expect(normaliseCatchRecord('not-an-object')).toBe('not-an-object')
    expect(normaliseCatchRecord(['array'])).toEqual(['array'])
  })

  test('Should deeply preserve input immutability across every nested level', () => {
    const payload = clientPayloadFrom(newDraftExample)
    const result = normaliseCatchRecord(payload)

    // The fixture itself is frozen (Step 05); if normalisation ever mutated it, this would throw.
    expect(() => {
      result.gears[0].characteristics[0].value = 'mutated'
    }).not.toThrow()
    expect(newDraftExample.gears[0].characteristics[0].value).not.toBe(
      'mutated'
    )
    expect(result.gears).not.toBe(payload.gears)
    expect(result.gears[0]).not.toBe(payload.gears[0])
    expect(result.gears[0].characteristics).not.toBe(
      payload.gears[0].characteristics
    )
    expect(result.landing).not.toBe(payload.landing)
    expect(result.trip.departurePort).not.toBe(payload.trip.departurePort)
  })

  test('Should produce deterministic output for equivalent repeated input', () => {
    const payload = clientPayloadFrom(newDraftExample)

    expect(normaliseCatchRecord(payload)).toEqual(normaliseCatchRecord(payload))
  })

  test('Should produce equivalent output regardless of input key insertion order', () => {
    const a = { vessel: { id: 'abc' }, trip: { dateStarted: '2026-10-05' } }
    const b = { trip: { dateStarted: '2026-10-05' }, vessel: { id: 'abc' } }

    expect(normaliseCatchRecord(a)).toEqual(normaliseCatchRecord(b))
  })

  test('Should not import Hapi, Boom, Joi, or MongoDB', () => {
    const source = readFileSync(
      new URL('./catch-record.js', import.meta.url),
      'utf8'
    )

    expect(source).not.toMatch(/from\s+['"]@hapi\/hapi['"]/)
    expect(source).not.toMatch(/from\s+['"]@hapi\/boom['"]/)
    expect(source).not.toMatch(/from\s+['"]joi['"]/)
    expect(source).not.toMatch(/from\s+['"]mongodb['"]/)
  })
})
