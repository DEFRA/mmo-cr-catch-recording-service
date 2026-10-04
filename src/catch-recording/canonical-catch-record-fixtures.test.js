import { validateCatchRecordStructureV1 } from './canonical-catch-record-contract.js'
import {
  createDraftCatchRecordFixture,
  createSubmittedCatchRecordFixture
} from './canonical-catch-record-fixtures.js'

describe('#createDraftCatchRecordFixture', () => {
  test('Should validate successfully against the v1 structural contract', () => {
    const { error } = validateCatchRecordStructureV1(
      createDraftCatchRecordFixture()
    )

    expect(error).toBeUndefined()
  })

  test('Should use only synthetic identifiers', () => {
    const fixture = createDraftCatchRecordFixture()

    expect(fixture.ownerUserId).toMatch(/^fixture-/)
  })

  test('Should apply overrides without mutating a shared default template', () => {
    const first = createDraftCatchRecordFixture({ status: 'DRAFT' })
    const second = createDraftCatchRecordFixture()

    first.gear.push({ gearId: 'mutated' })

    expect(second.gear).toEqual([])
  })
})

describe('#createSubmittedCatchRecordFixture', () => {
  test('Should validate successfully against the v1 structural contract', () => {
    const { error } = validateCatchRecordStructureV1(
      createSubmittedCatchRecordFixture()
    )

    expect(error).toBeUndefined()
  })

  test('Should contain at least two gears', () => {
    const fixture = createSubmittedCatchRecordFixture()

    expect(fixture.gear.length).toBeGreaterThanOrEqual(2)
  })

  test('Should give each gear a distinct statistical area', () => {
    const fixture = createSubmittedCatchRecordFixture()

    expect(fixture.gear[0].statisticalArea.id).not.toBe(
      fixture.gear[1].statisticalArea.id
    )
  })

  test('Should give each gear at least one species', () => {
    const fixture = createSubmittedCatchRecordFixture()

    for (const gear of fixture.gear) {
      expect(gear.speciesCaught.length).toBeGreaterThanOrEqual(1)
    }
  })

  test('Should allow the same species to appear beneath both gears', () => {
    const fixture = createSubmittedCatchRecordFixture()

    expect(fixture.gear[0].speciesCaught[0].speciesId).toBe(
      fixture.gear[1].speciesCaught[0].speciesId
    )
  })

  test('Should not share mutable attribute state between same-species entries under different gears', () => {
    const fixture = createSubmittedCatchRecordFixture()

    fixture.gear[0].speciesCaught[0].attributes.push({
      attributeId: 'mutated',
      nameSnapshot: 'Mutated',
      value: 'mutated'
    })

    expect(fixture.gear[1].speciesCaught[0].attributes).toHaveLength(1)
  })
})

describe('Fixture independence', () => {
  test('Should not share nested gear arrays between two separate draft calls', () => {
    const first = createDraftCatchRecordFixture({ gear: [{ gearId: 'g1' }] })
    const second = createDraftCatchRecordFixture({ gear: [{ gearId: 'g1' }] })

    expect(first.gear).not.toBe(second.gear)
    expect(first.gear[0]).not.toBe(second.gear[0])
  })

  test('Should not share nested gear arrays between two separate submitted calls', () => {
    const first = createSubmittedCatchRecordFixture()
    const second = createSubmittedCatchRecordFixture()

    expect(first.gear).not.toBe(second.gear)
    expect(first.gear[0]).not.toBe(second.gear[0])
    expect(first.gear[0].speciesCaught[0].attributes).not.toBe(
      second.gear[0].speciesCaught[0].attributes
    )
  })

  test('Should not share state between the draft and submitted fixture kinds', () => {
    const draft = createDraftCatchRecordFixture()
    const submitted = createSubmittedCatchRecordFixture()

    submitted.gear.push({ gearId: 'extra' })

    expect(draft.gear).toEqual([])
  })

  test('Mutating one fixture should not affect another', () => {
    const first = createSubmittedCatchRecordFixture()
    const second = createSubmittedCatchRecordFixture()

    first.artifacts.push({ submissionNumber: 99 })
    first.audit.editEvents.push({ reason: 'mutated' })

    expect(second.artifacts).toHaveLength(1)
    expect(second.audit.editEvents).toHaveLength(1)
  })
})
