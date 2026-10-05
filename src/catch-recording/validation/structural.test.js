import { readFileSync } from 'node:fs'

import { validateStructure } from './structural.js'
import { newDraftExample } from '../domain/__fixtures__/canonical-catch-record.fixtures.js'

describe('#validateStructure', () => {
  test('Should validate a complete, well-formed canonical object', () => {
    expect(validateStructure(newDraftExample)).toEqual({
      valid: true,
      issues: []
    })
  })

  test('Should reject a malformed (non-object) root', () => {
    const result = validateStructure('not-an-object')

    expect(result.valid).toBe(false)
    expect(result.issues[0].code).toBe('INVALID_STRUCTURE')
    expect(result.issues[0].path).toBe('')
  })

  test('Should reject null, undefined, and array roots', () => {
    expect(validateStructure(null).valid).toBe(false)
    expect(validateStructure(undefined).valid).toBe(false)
    expect(validateStructure([]).valid).toBe(false)
  })

  test('Should accept a minimal partial draft with no sections at all', () => {
    expect(validateStructure({})).toEqual({ valid: true, issues: [] })
  })

  test('Should accept the approved schema version', () => {
    expect(validateStructure({ schemaVersion: 1 }).valid).toBe(true)
  })

  test('Should reject an unsupported schema version', () => {
    const result = validateStructure({ schemaVersion: 2 })

    expect(result.valid).toBe(false)
    expect(result.issues).toContainEqual({
      code: 'UNSUPPORTED_VALUE',
      path: 'schemaVersion',
      message: 'Unsupported schema version'
    })
  })

  test.each(['DRAFT', 'SUBMITTED', 'COMPLETE'])(
    'Should accept the approved status %s',
    (status) => {
      expect(validateStructure({ status }).valid).toBe(true)
    }
  )

  test.each([
    'DRAFT_EDIT',
    'AMENDED',
    'ABANDONED',
    'WITHDRAWN',
    'NOT_A_STATUS'
  ])('Should reject the unsupported status %s', (status) => {
    const result = validateStructure({ status })

    expect(result.valid).toBe(false)
    expect(result.issues).toContainEqual({
      code: 'UNSUPPORTED_VALUE',
      path: 'status',
      message: 'Unsupported status'
    })
  })

  test.each(['vessel', 'trip', 'pairFishing', 'landing'])(
    'Should reject a malformed (non-object) %s',
    (field) => {
      const result = validateStructure({ [field]: 'not-an-object' })

      expect(result.valid).toBe(false)
      expect(result.issues).toContainEqual({
        code: 'INVALID_STRUCTURE',
        path: field,
        message: 'Invalid structure'
      })
    }
  )

  test.each(['vessel', 'trip', 'pairFishing', 'landing'])(
    'Should accept an absent or null %s',
    (field) => {
      expect(validateStructure({ [field]: undefined }).valid).toBe(true)
      expect(validateStructure({ [field]: null }).valid).toBe(true)
    }
  )

  test('Should reject a root-level statisticalArea field', () => {
    const result = validateStructure({ statisticalArea: { id: 'area-1' } })

    expect(result.valid).toBe(false)
    expect(result.issues).toContainEqual({
      code: 'INVALID_STRUCTURE',
      path: 'statisticalArea',
      message:
        'Statistical area must belong to a gear association, not the Catch Record root'
    })
  })

  test('Should reject a root-level speciesCaught field', () => {
    const result = validateStructure({ speciesCaught: [] })

    expect(result.valid).toBe(false)
    expect(result.issues).toContainEqual({
      code: 'INVALID_STRUCTURE',
      path: 'speciesCaught',
      message:
        'Species must belong to a gear association, not the Catch Record root'
    })
  })

  test.each(['history', 'events'])(
    'Should reject an embedded %s collection',
    (field) => {
      const result = validateStructure({ [field]: [] })

      expect(result.valid).toBe(false)
      expect(result.issues).toContainEqual({
        code: 'INVALID_STRUCTURE',
        path: field,
        message: 'History must not be embedded'
      })
    }
  )

  test('Should reject a malformed (non-array) gears collection', () => {
    const result = validateStructure({ gears: 'not-an-array' })

    expect(result.valid).toBe(false)
    expect(result.issues).toContainEqual({
      code: 'INVALID_STRUCTURE',
      path: 'gears',
      message: 'Invalid structure'
    })
  })

  test('Should reject a malformed (non-object) gear entry without crashing on nested access', () => {
    const result = validateStructure({ gears: ['not-an-object', null] })

    expect(result.valid).toBe(false)
    expect(result.issues).toContainEqual({
      code: 'INVALID_STRUCTURE',
      path: 'gears.0',
      message: 'Invalid structure'
    })
    expect(result.issues).toContainEqual({
      code: 'INVALID_STRUCTURE',
      path: 'gears.1',
      message: 'Invalid structure'
    })
  })

  test('Should reject a malformed (non-object) species-association entry without crashing', () => {
    const result = validateStructure({
      gears: [
        { associationId: 'gear-1', speciesCaught: ['not-an-object', null] }
      ]
    })

    expect(result.valid).toBe(false)
    expect(result.issues).toContainEqual({
      code: 'INVALID_STRUCTURE',
      path: 'gears.0.speciesCaught.0',
      message: 'Invalid structure'
    })
  })

  test('Should ignore a malformed (non-object) artifact entry rather than crash', () => {
    const result = validateStructure({ artifacts: ['not-an-object', null] })

    expect(result.valid).toBe(true)
  })

  test('Should require a stable associationId on every gear occurrence', () => {
    const result = validateStructure({ gears: [{ gear: { id: 'gear-1' } }] })

    expect(result.valid).toBe(false)
    expect(result.issues).toContainEqual({
      code: 'REQUIRED',
      path: 'gears.0.associationId',
      message: 'Required'
    })
  })

  test('Should reject an empty-string associationId', () => {
    const result = validateStructure({ gears: [{ associationId: '   ' }] })

    expect(result.issues).toContainEqual({
      code: 'REQUIRED',
      path: 'gears.0.associationId',
      message: 'Required'
    })
  })

  test('Should require a stable associationId on every gear-to-species relationship', () => {
    const result = validateStructure({
      gears: [
        {
          associationId: 'gear-1',
          speciesCaught: [{ species: { id: 'species-1' } }]
        }
      ]
    })

    expect(result.valid).toBe(false)
    expect(result.issues).toContainEqual({
      code: 'REQUIRED',
      path: 'gears.0.speciesCaught.0.associationId',
      message: 'Required'
    })
  })

  test('Should validate characteristics, statistical area, and catch details nested under their gear', () => {
    const result = validateStructure({
      gears: [
        {
          associationId: 'gear-1',
          characteristics: ['not-an-object'],
          statisticalArea: 'not-an-object',
          speciesCaught: [
            {
              associationId: 'species-1',
              catchDetails: ['not-an-object']
            }
          ]
        }
      ]
    })

    expect(result.issues).toContainEqual({
      code: 'INVALID_STRUCTURE',
      path: 'gears.0.characteristics.0',
      message: 'Invalid structure'
    })
    expect(result.issues).toContainEqual({
      code: 'INVALID_STRUCTURE',
      path: 'gears.0.statisticalArea',
      message: 'Invalid structure'
    })
    expect(result.issues).toContainEqual({
      code: 'INVALID_STRUCTURE',
      path: 'gears.0.speciesCaught.0.catchDetails.0',
      message: 'Invalid structure'
    })
  })

  test('Should not require statisticalArea or speciesCaught to be present (completeness deferred)', () => {
    expect(
      validateStructure({ gears: [{ associationId: 'gear-1' }] }).valid
    ).toBe(true)
  })

  test('Should reject artifact metadata containing an artifact body', () => {
    const result = validateStructure({
      artifacts: [
        {
          submissionNumber: 1,
          type: 'JSON_SNAPSHOT',
          content: 'should not be here'
        }
      ]
    })

    expect(result.valid).toBe(false)
    expect(result.issues).toContainEqual({
      code: 'INVALID_STRUCTURE',
      path: 'artifacts.0.content',
      message: 'Artifact metadata must not contain an artifact body'
    })
  })

  test('Should accept approved artifact metadata with no body', () => {
    expect(
      validateStructure({
        artifacts: [{ submissionNumber: 1, type: 'JSON_SNAPSHOT' }]
      }).valid
    ).toBe(true)
  })

  test('Should return all discoverable issues rather than stopping at the first', () => {
    const result = validateStructure({
      schemaVersion: 2,
      status: 'INVALID',
      gears: 'not-an-array'
    })

    expect(result.issues.length).toBeGreaterThanOrEqual(3)
  })

  test('Should not mutate the input', () => {
    const inputCopy = JSON.parse(JSON.stringify(newDraftExample))
    validateStructure(newDraftExample)

    expect(newDraftExample).toEqual(inputCopy)
  })

  test('Should produce deterministic output for equivalent repeated input', () => {
    expect(validateStructure(newDraftExample)).toEqual(
      validateStructure(newDraftExample)
    )
  })

  test('Should not import Hapi, Boom, Joi, or MongoDB', () => {
    const source = readFileSync(
      new URL('./structural.js', import.meta.url),
      'utf8'
    )

    expect(source).not.toMatch(/from\s+['"]@hapi\/hapi['"]/)
    expect(source).not.toMatch(/from\s+['"]@hapi\/boom['"]/)
    expect(source).not.toMatch(/from\s+['"]joi['"]/)
    expect(source).not.toMatch(/from\s+['"]mongodb['"]/)
  })
})
