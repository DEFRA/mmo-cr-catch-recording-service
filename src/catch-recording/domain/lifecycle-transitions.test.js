import { readFileSync } from 'node:fs'

import {
  buildCompletionFacts,
  buildEditStartFacts,
  buildResubmissionFacts,
  canAbandon,
  canComplete,
  canResubmit,
  canStartEdit,
  canSubmitFirstTime
} from './lifecycle-transitions.js'
import {
  amendedDraftExample,
  completeExample,
  newDraftExample,
  submittedExample
} from './__fixtures__/canonical-catch-record.fixtures.js'
import { calculateNextSubmissionNumber } from './submission-number.js'

describe('#canSubmitFirstTime', () => {
  test('Should be eligible for a never-submitted draft', () => {
    expect(canSubmitFirstTime(newDraftExample)).toEqual({
      valid: true,
      issues: []
    })
  })

  test('Should calculate the first submission number as 1', () => {
    expect(
      calculateNextSubmissionNumber(newDraftExample.numberOfSubmissions)
    ).toBe(1)
  })

  test('Should be ineligible for a submitted record', () => {
    expect(canSubmitFirstTime(submittedExample).valid).toBe(false)
  })

  test('Should be ineligible for a completed record', () => {
    expect(canSubmitFirstTime(completeExample).valid).toBe(false)
  })

  test('Should be ineligible for an amended draft', () => {
    expect(canSubmitFirstTime(amendedDraftExample).valid).toBe(false)
  })

  test('Should be ineligible for an invalid submission count', () => {
    expect(
      canSubmitFirstTime({ ...newDraftExample, numberOfSubmissions: 1 }).valid
    ).toBe(false)
  })

  test('Should not mutate the input', () => {
    const inputCopy = JSON.parse(JSON.stringify(newDraftExample))
    canSubmitFirstTime(newDraftExample)

    expect(newDraftExample).toEqual(inputCopy)
  })
})

describe('#canComplete / #buildCompletionFacts', () => {
  test('Should be eligible for a submitted record', () => {
    expect(canComplete(submittedExample)).toEqual({ valid: true, issues: [] })
  })

  test('Should be ineligible for DRAFT', () => {
    expect(canComplete(newDraftExample).valid).toBe(false)
  })

  test('Should be ineligible for COMPLETE', () => {
    expect(canComplete(completeExample).valid).toBe(false)
  })

  test('Should propose only the target status, nothing else', () => {
    expect(buildCompletionFacts(submittedExample)).toEqual({
      status: 'COMPLETE'
    })
  })
})

describe('#canStartEdit / #buildEditStartFacts', () => {
  test('Should be eligible for a submitted record', () => {
    expect(canStartEdit(submittedExample)).toEqual({ valid: true, issues: [] })
  })

  test('Should be eligible for a completed record', () => {
    expect(canStartEdit(completeExample)).toEqual({ valid: true, issues: [] })
  })

  test('Should be ineligible for DRAFT', () => {
    expect(canStartEdit(newDraftExample).valid).toBe(false)
  })

  test('Should preserve identity, reference, submission count, and artifacts', () => {
    const facts = buildEditStartFacts(submittedExample)

    expect(facts.id).toBe(submittedExample.id)
    expect(facts.catchRecordReference).toBe(
      submittedExample.catchRecordReference
    )
    expect(facts.numberOfSubmissions).toBe(submittedExample.numberOfSubmissions)
    expect(facts.artifacts).toBe(submittedExample.artifacts)
  })

  test('Should propose status DRAFT and hasUnsubmittedChanges true', () => {
    const facts = buildEditStartFacts(submittedExample)

    expect(facts.status).toBe('DRAFT')
    expect(facts.hasUnsubmittedChanges).toBe(true)
  })

  test('Should preserve completedAt/completedBy unchanged (owner decision)', () => {
    const facts = buildEditStartFacts(completeExample)

    expect(facts.completedAt).toBe(completeExample.completedAt)
    expect(facts.completedBy).toBe(completeExample.completedBy)
  })

  test('Should not generate a new identity or timestamp', () => {
    const facts = buildEditStartFacts(submittedExample)

    expect(Object.keys(facts).sort()).toEqual(
      [
        'id',
        'catchRecordReference',
        'numberOfSubmissions',
        'artifacts',
        'status',
        'hasUnsubmittedChanges',
        'completedAt',
        'completedBy'
      ].sort()
    )
  })

  test('Should not mutate the input', () => {
    const inputCopy = JSON.parse(JSON.stringify(submittedExample))
    buildEditStartFacts(submittedExample)

    expect(submittedExample).toEqual(inputCopy)
  })
})

describe('#canResubmit / #buildResubmissionFacts', () => {
  test('Should be eligible for an amended draft', () => {
    expect(canResubmit(amendedDraftExample)).toEqual({
      valid: true,
      issues: []
    })
  })

  test('Should be ineligible for a never-submitted draft', () => {
    expect(canResubmit(newDraftExample).valid).toBe(false)
  })

  test('Should be ineligible for a submitted record', () => {
    expect(canResubmit(submittedExample).valid).toBe(false)
  })

  test('Should be ineligible for a completed record until edit start', () => {
    expect(canResubmit(completeExample).valid).toBe(false)
  })

  test('Should calculate the next submission number as current count plus one', () => {
    expect(
      calculateNextSubmissionNumber(amendedDraftExample.numberOfSubmissions)
    ).toBe(amendedDraftExample.numberOfSubmissions + 1)
  })

  test('Should propose status SUBMITTED and hasUnsubmittedChanges false', () => {
    const nextNumber = calculateNextSubmissionNumber(
      amendedDraftExample.numberOfSubmissions
    )
    const facts = buildResubmissionFacts(amendedDraftExample, nextNumber)

    expect(facts).toEqual({
      status: 'SUBMITTED',
      numberOfSubmissions: nextNumber,
      hasUnsubmittedChanges: false
    })
  })

  test('Should not write an artifact (no artifacts field in the proposed facts)', () => {
    const facts = buildResubmissionFacts(amendedDraftExample, 2)

    expect(facts).not.toHaveProperty('artifacts')
  })
})

describe('#canAbandon', () => {
  test('Should be eligible for a never-submitted draft', () => {
    expect(canAbandon(newDraftExample)).toEqual({ valid: true, issues: [] })
  })

  test('Should be ineligible for an amended draft', () => {
    expect(canAbandon(amendedDraftExample).valid).toBe(false)
  })

  test('Should be ineligible for a submitted record', () => {
    expect(canAbandon(submittedExample).valid).toBe(false)
  })

  test('Should be ineligible for a completed record', () => {
    expect(canAbandon(completeExample).valid).toBe(false)
  })

  test('Should be ineligible when committed artifact metadata exists', () => {
    expect(
      canAbandon({
        ...newDraftExample,
        artifacts: [{ submissionNumber: 1, type: 'JSON_SNAPSHOT' }]
      }).valid
    ).toBe(false)
  })

  test('Should be ineligible when submission metadata exists', () => {
    expect(
      canAbandon({ ...newDraftExample, submittedAt: '2026-01-01T00:00:00Z' })
        .valid
    ).toBe(false)
  })

  test('Should not mutate the input', () => {
    const inputCopy = JSON.parse(JSON.stringify(newDraftExample))
    canAbandon(newDraftExample)

    expect(newDraftExample).toEqual(inputCopy)
  })
})

describe('#ownField missing-key handling', () => {
  test('Should treat an absent key the same as an undefined value', () => {
    // `status` is entirely absent (not merely set to undefined), exercising the branch of
    // `ownField` that returns `undefined` without reading through to `catchRecord[field]`.
    expect(canSubmitFirstTime({ numberOfSubmissions: 0 }).valid).toBe(false)
  })
})

describe('malformed root handling', () => {
  test.each([
    ['canSubmitFirstTime', canSubmitFirstTime],
    ['canComplete', canComplete],
    ['canStartEdit', canStartEdit],
    ['canResubmit', canResubmit],
    ['canAbandon', canAbandon]
  ])(
    '%s should reject a malformed (non-object) value',
    (_name, eligibilityCheck) => {
      expect(eligibilityCheck(undefined).valid).toBe(false)
      expect(eligibilityCheck(null).valid).toBe(false)
      expect(eligibilityCheck('not-an-object').valid).toBe(false)
    }
  )
})

describe('#lifecycle-transitions architecture boundary', () => {
  test('Should not import Hapi, Boom, Joi, or MongoDB', () => {
    const source = readFileSync(
      new URL('./lifecycle-transitions.js', import.meta.url),
      'utf8'
    )

    expect(source).not.toMatch(/from\s+['"]@hapi\/hapi['"]/)
    expect(source).not.toMatch(/from\s+['"]@hapi\/boom['"]/)
    expect(source).not.toMatch(/from\s+['"]joi['"]/)
    expect(source).not.toMatch(/from\s+['"]mongodb['"]/)
  })
})
