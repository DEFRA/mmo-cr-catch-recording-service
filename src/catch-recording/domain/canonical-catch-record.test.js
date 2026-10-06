import { readFileSync } from 'node:fs'

import {
  CANONICAL_SCHEMA_VERSION,
  NEW_DRAFT_DEFAULTS
} from './canonical-catch-record.js'
import {
  amendedDraftExample,
  completeExample,
  newDraftExample,
  submittedExample
} from './__fixtures__/canonical-catch-record.fixtures.js'

const FIXTURES = {
  newDraftExample,
  submittedExample,
  amendedDraftExample,
  completeExample
}

describe('#canonical-catch-record', () => {
  test('Should define the approved schema version', () => {
    expect(CANONICAL_SCHEMA_VERSION).toBe(1)
  })

  test('Should define the approved new-draft invariant subset exactly', () => {
    expect(NEW_DRAFT_DEFAULTS).toEqual({
      numberOfSubmissions: 0,
      hasUnsubmittedChanges: false,
      artifacts: [],
      submittedAt: null,
      submittedBy: null,
      completedAt: null,
      completedBy: null
    })
  })

  test('Should not allow NEW_DRAFT_DEFAULTS to be mutated', () => {
    expect(() => {
      NEW_DRAFT_DEFAULTS.numberOfSubmissions = 99
    }).toThrow()

    expect(() => {
      NEW_DRAFT_DEFAULTS.artifacts.push({
        submissionNumber: 1,
        type: 'JSON_SNAPSHOT'
      })
    }).toThrow()
  })

  describe.each(Object.entries(FIXTURES))('%s', (_name, fixture) => {
    test('Should carry the approved schema version', () => {
      expect(fixture.schemaVersion).toBe(CANONICAL_SCHEMA_VERSION)
    })

    test('Should have no root-level statistical-area field', () => {
      expect(fixture).not.toHaveProperty('statisticalArea')
    })

    test('Should have no root-level species collection', () => {
      expect(fixture).not.toHaveProperty('species')
      expect(fixture).not.toHaveProperty('speciesCaught')
    })

    test('Should nest statistical area and species beneath each gear association', () => {
      for (const gearAssociation of fixture.gears) {
        expect(gearAssociation).toHaveProperty('associationId')
        expect(gearAssociation).toHaveProperty('statisticalArea')
        expect(Array.isArray(gearAssociation.speciesCaught)).toBe(true)

        for (const speciesEntry of gearAssociation.speciesCaught) {
          expect(speciesEntry).toHaveProperty('id')
        }
      }
    })

    test('Should keep speciesNotLanded independent of every gear association', () => {
      expect(Array.isArray(fixture.speciesNotLanded)).toBe(true)

      for (const speciesEntry of fixture.speciesNotLanded) {
        expect(speciesEntry).toHaveProperty('id')
      }
    })

    test('Should contain only artifact metadata, never an embedded artifact body', () => {
      for (const artifact of fixture.artifacts) {
        expect(artifact).not.toHaveProperty('content')
        expect(artifact).not.toHaveProperty('body')
        expect(artifact).not.toHaveProperty('json')
        expect(artifact).not.toHaveProperty('pdf')
      }
    })

    test('Should not embed history events', () => {
      expect(fixture).not.toHaveProperty('history')
      expect(fixture).not.toHaveProperty('events')
    })

    test('Should not represent any persisted status outside the approved three', () => {
      expect(['DRAFT', 'SUBMITTED', 'COMPLETE']).toContain(fixture.status)
    })

    test('Should not carry any derived response field', () => {
      expect(fixture).not.toHaveProperty('displayStatus')
      expect(fixture).not.toHaveProperty('completedSections')
      expect(fixture).not.toHaveProperty('incompleteSections')
      expect(fixture).not.toHaveProperty('submissionEligible')
      expect(fixture).not.toHaveProperty('frontendRoute')
      expect(fixture).not.toHaveProperty('screen')
      expect(fixture).not.toHaveProperty('nextStep')
    })

    test('Should be frozen and reject mutation attempts', () => {
      expect(Object.isFrozen(fixture)).toBe(true)
      expect(() => {
        fixture.status = 'DRAFT_EDIT'
      }).toThrow()
      expect(Object.isFrozen(fixture.gears)).toBe(true)
      expect(Object.isFrozen(fixture.gears[0])).toBe(true)
    })
  })

  test('A never-submitted draft should have an empty artifact collection', () => {
    expect(newDraftExample.numberOfSubmissions).toBe(0)
    expect(newDraftExample.artifacts).toEqual([])
    expect(newDraftExample.submittedAt).toBeNull()
    expect(newDraftExample.submittedBy).toBeNull()
  })

  test('A submitted record should have matching submission metadata and at least one artifact', () => {
    expect(submittedExample.numberOfSubmissions).toBeGreaterThan(0)
    expect(submittedExample.artifacts.length).toBeGreaterThan(0)
    expect(submittedExample.submittedAt).not.toBeNull()
    expect(submittedExample.submittedBy).not.toBeNull()
  })

  test('An amended record should remain persisted as DRAFT with prior artifacts preserved', () => {
    expect(amendedDraftExample.status).toBe('DRAFT')
    expect(amendedDraftExample.numberOfSubmissions).toBeGreaterThan(0)
    expect(amendedDraftExample.hasUnsubmittedChanges).toBe(true)
    expect(amendedDraftExample.artifacts.length).toBeGreaterThan(0)
  })

  test('Should not import Hapi, Boom, Joi, or MongoDB', () => {
    const source = readFileSync(
      new URL('./canonical-catch-record.js', import.meta.url),
      'utf8'
    )

    expect(source).not.toMatch(/from\s+['"]@hapi\/hapi['"]/)
    expect(source).not.toMatch(/from\s+['"]@hapi\/boom['"]/)
    expect(source).not.toMatch(/from\s+['"]joi['"]/)
    expect(source).not.toMatch(/from\s+['"]mongodb['"]/)
  })
})
