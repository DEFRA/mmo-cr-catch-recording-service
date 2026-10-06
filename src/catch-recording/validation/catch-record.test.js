import { readFileSync } from 'node:fs'

import { validateCatchRecord } from './catch-record.js'
import {
  amendedDraftExample,
  completeExample,
  newDraftExample,
  submittedExample
} from '../domain/__fixtures__/canonical-catch-record.fixtures.js'

describe('#validateCatchRecord', () => {
  test.each(
    Object.entries({
      newDraftExample,
      submittedExample,
      amendedDraftExample,
      completeExample
    })
  )(
    'Should accept the approved %s fixture as currently valid',
    (_name, fixture) => {
      expect(validateCatchRecord(fixture)).toEqual({ valid: true, issues: [] })
    }
  )

  test('Should return a single structural issue for a malformed root without further nested issues', () => {
    const result = validateCatchRecord('not-an-object')

    expect(result.valid).toBe(false)
    expect(result.issues).toEqual([
      { code: 'INVALID_STRUCTURE', path: '', message: 'Invalid structure' }
    ])
  })

  test('Should combine issues from every composed validator without duplication', () => {
    const result = validateCatchRecord({
      schemaVersion: 2, // structural: UNSUPPORTED_VALUE
      gears: [
        { associationId: 'gear-1', speciesCaught: [{ associationId: 's1' }] },
        { associationId: 'gear-1', speciesCaught: [] } // gears: DUPLICATE_RELATIONSHIP
      ],
      pairFishing: { enabled: false, pairVessel: { id: 'abc' } }, // pair-fishing: CONDITIONAL_FIELD_INCONSISTENT
      landing: {
        retainedSpecies: [
          { gearAssociationId: 'missing-gear', speciesAssociationId: 's1' }
        ] // landing: INVALID_REFERENCE
      }
    })

    expect(result.valid).toBe(false)
    const codes = result.issues.map((issue) => issue.code)
    expect(codes).toContain('UNSUPPORTED_VALUE')
    expect(codes).toContain('DUPLICATE_RELATIONSHIP')
    expect(codes).toContain('CONDITIONAL_FIELD_INCONSISTENT')
    expect(codes).toContain('INVALID_REFERENCE')
    expect(
      new Set(result.issues.map((issue) => `${issue.code}|${issue.path}`)).size
    ).toBe(result.issues.length)
  })

  test('Should produce deterministic issue ordering (structure, gears, pair-fishing, landing)', () => {
    const payload = {
      schemaVersion: 2,
      gears: [{ associationId: 'gear-1' }, { associationId: 'gear-1' }],
      pairFishing: { enabled: false, pairSkipperName: 'Jane' },
      landing: {
        retainedSpecies: [
          { gearAssociationId: 'missing', speciesAssociationId: 'missing' }
        ]
      }
    }

    const first = validateCatchRecord(payload)
    const second = validateCatchRecord(payload)

    expect(first.issues.map((issue) => issue.code)).toEqual(
      second.issues.map((issue) => issue.code)
    )
    expect(first).toEqual(second)
  })

  test('Should enforce the Step 21-resolved pair-fishing "enabled requires fields" rule', () => {
    // pairFishing.enabled = true with no populated fields: Step 21 resolved this previously-deferred
    // direction - pairVessel/pairSkipperName are now required.
    const result = validateCatchRecord({ pairFishing: { enabled: true } })

    expect(result.valid).toBe(false)
    expect(result.issues).toContainEqual({
      code: 'REQUIRED',
      path: 'pairFishing.pairVessel',
      message: 'Required when pair fishing is enabled'
    })
  })

  test('Should reuse section validators rather than duplicating their rules', () => {
    // A duplicate gear-association id is only detected once, by validateGears, not re-reported by
    // validateStructure as well.
    const result = validateCatchRecord({
      gears: [{ associationId: 'gear-1' }, { associationId: 'gear-1' }]
    })

    const duplicateIssues = result.issues.filter(
      (issue) => issue.code === 'DUPLICATE_RELATIONSHIP'
    )
    expect(duplicateIssues).toHaveLength(1)
  })

  test('Should not mutate the input', () => {
    const inputCopy = JSON.parse(JSON.stringify(newDraftExample))
    validateCatchRecord(newDraftExample)

    expect(newDraftExample).toEqual(inputCopy)
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
