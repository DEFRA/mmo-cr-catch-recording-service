import { readFileSync } from 'node:fs'

import {
  checkLifecycleInvariants,
  isAmendedDraft,
  isConsistentAmendedState,
  isConsistentCompletedState,
  isConsistentSubmittedState,
  isNewDraft
} from './lifecycle-consistency.js'
import {
  amendedDraftExample,
  completeExample,
  newDraftExample,
  submittedExample
} from './__fixtures__/canonical-catch-record.fixtures.js'

describe('#isAmendedDraft', () => {
  test('Should be true for DRAFT with prior submissions', () => {
    expect(isAmendedDraft(amendedDraftExample)).toBe(true)
  })

  test('Should be false for a never-submitted DRAFT', () => {
    expect(isAmendedDraft(newDraftExample)).toBe(false)
  })

  test('Should be false for SUBMITTED or COMPLETE', () => {
    expect(isAmendedDraft(submittedExample)).toBe(false)
    expect(isAmendedDraft(completeExample)).toBe(false)
  })

  test('Should be false for a malformed value', () => {
    expect(isAmendedDraft(undefined)).toBe(false)
    expect(isAmendedDraft(null)).toBe(false)
    expect(isAmendedDraft('not-an-object')).toBe(false)
  })
})

describe('#isNewDraft', () => {
  test('Should accept the approved new-draft fixture', () => {
    expect(isNewDraft(newDraftExample)).toEqual({ valid: true, issues: [] })
  })

  test('Should reject a non-zero submission count', () => {
    expect(
      isNewDraft({ ...newDraftExample, numberOfSubmissions: 1 }).valid
    ).toBe(false)
  })

  test('Should reject existing artifact metadata', () => {
    expect(
      isNewDraft({
        ...newDraftExample,
        artifacts: [{ submissionNumber: 1, type: 'JSON_SNAPSHOT' }]
      }).valid
    ).toBe(false)
  })

  test('Should reject existing submission metadata', () => {
    expect(
      isNewDraft({ ...newDraftExample, submittedAt: '2026-01-01T00:00:00Z' })
        .valid
    ).toBe(false)
    expect(
      isNewDraft({ ...newDraftExample, submittedBy: 'user-1' }).valid
    ).toBe(false)
  })

  test('Should reject existing completion metadata', () => {
    expect(
      isNewDraft({ ...newDraftExample, completedAt: '2026-01-01T00:00:00Z' })
        .valid
    ).toBe(false)
    expect(
      isNewDraft({ ...newDraftExample, completedBy: 'user-1' }).valid
    ).toBe(false)
  })

  test('Should reject hasUnsubmittedChanges = true', () => {
    expect(
      isNewDraft({ ...newDraftExample, hasUnsubmittedChanges: true }).valid
    ).toBe(false)
  })

  test('Should reject a wrong status', () => {
    expect(isNewDraft({ ...newDraftExample, status: 'SUBMITTED' }).valid).toBe(
      false
    )
  })

  test('Should reject a malformed value', () => {
    expect(isNewDraft(undefined).valid).toBe(false)
    expect(isNewDraft('not-an-object').valid).toBe(false)
  })

  test('Should not mutate the input', () => {
    const inputCopy = JSON.parse(JSON.stringify(newDraftExample))
    isNewDraft(newDraftExample)

    expect(newDraftExample).toEqual(inputCopy)
  })
})

describe('#isConsistentAmendedState', () => {
  test('Should accept the approved amended-draft fixture', () => {
    expect(isConsistentAmendedState(amendedDraftExample)).toEqual({
      valid: true,
      issues: []
    })
  })

  test('Should reject a never-submitted draft (zero submissions)', () => {
    expect(isConsistentAmendedState(newDraftExample).valid).toBe(false)
  })

  test('Should reject hasUnsubmittedChanges = false', () => {
    expect(
      isConsistentAmendedState({
        ...amendedDraftExample,
        hasUnsubmittedChanges: false
      }).valid
    ).toBe(false)
  })

  test('Should reject missing prior artifact evidence', () => {
    expect(
      isConsistentAmendedState({ ...amendedDraftExample, artifacts: [] }).valid
    ).toBe(false)
  })

  test('Should reject a wrong status', () => {
    expect(
      isConsistentAmendedState({ ...amendedDraftExample, status: 'SUBMITTED' })
        .valid
    ).toBe(false)
  })

  test('Should reject a malformed value', () => {
    expect(isConsistentAmendedState(undefined).valid).toBe(false)
    expect(isConsistentAmendedState(null).valid).toBe(false)
    expect(isConsistentAmendedState('not-an-object').valid).toBe(false)
  })
})

describe('#isConsistentSubmittedState', () => {
  test('Should accept the approved submitted fixture', () => {
    expect(isConsistentSubmittedState(submittedExample)).toEqual({
      valid: true,
      issues: []
    })
  })

  test('Should reject zero submissions', () => {
    expect(
      isConsistentSubmittedState({
        ...submittedExample,
        numberOfSubmissions: 0
      }).valid
    ).toBe(false)
  })

  test('Should reject missing current submission metadata', () => {
    expect(
      isConsistentSubmittedState({ ...submittedExample, submittedAt: null })
        .valid
    ).toBe(false)
    expect(
      isConsistentSubmittedState({ ...submittedExample, submittedBy: null })
        .valid
    ).toBe(false)
  })

  test('Should reject missing approved artifact metadata', () => {
    expect(
      isConsistentSubmittedState({ ...submittedExample, artifacts: [] }).valid
    ).toBe(false)
  })

  test('Should reject hasUnsubmittedChanges = true', () => {
    expect(
      isConsistentSubmittedState({
        ...submittedExample,
        hasUnsubmittedChanges: true
      }).valid
    ).toBe(false)
  })

  test('Should reject completion metadata while SUBMITTED', () => {
    expect(
      isConsistentSubmittedState({
        ...submittedExample,
        completedAt: '2026-01-01T00:00:00Z'
      }).valid
    ).toBe(false)
    expect(
      isConsistentSubmittedState({ ...submittedExample, completedBy: 'user-1' })
        .valid
    ).toBe(false)
  })

  test('Should reject a wrong status', () => {
    expect(
      isConsistentSubmittedState({ ...submittedExample, status: 'DRAFT' }).valid
    ).toBe(false)
  })

  test('Should reject a malformed value', () => {
    expect(isConsistentSubmittedState(undefined).valid).toBe(false)
  })
})

describe('#isConsistentCompletedState', () => {
  test('Should accept the approved complete fixture', () => {
    expect(isConsistentCompletedState(completeExample)).toEqual({
      valid: true,
      issues: []
    })
  })

  test('Should reject missing completion metadata', () => {
    expect(
      isConsistentCompletedState({ ...completeExample, completedAt: null })
        .valid
    ).toBe(false)
    expect(
      isConsistentCompletedState({ ...completeExample, completedBy: null })
        .valid
    ).toBe(false)
  })

  test('Should reject missing prior submission evidence', () => {
    expect(
      isConsistentCompletedState({ ...completeExample, artifacts: [] }).valid
    ).toBe(false)
    expect(
      isConsistentCompletedState({ ...completeExample, numberOfSubmissions: 0 })
        .valid
    ).toBe(false)
  })

  test('Should reject hasUnsubmittedChanges = true', () => {
    expect(
      isConsistentCompletedState({
        ...completeExample,
        hasUnsubmittedChanges: true
      }).valid
    ).toBe(false)
  })

  test('Should reject a wrong status', () => {
    expect(
      isConsistentCompletedState({ ...completeExample, status: 'SUBMITTED' })
        .valid
    ).toBe(false)
  })

  test('Should reject a malformed value', () => {
    expect(isConsistentCompletedState(undefined).valid).toBe(false)
  })
})

describe('#checkLifecycleInvariants (decision matrix)', () => {
  test.each([
    ['valid never-submitted draft', newDraftExample, true],
    [
      'invalid never-submitted draft with artifacts',
      {
        ...newDraftExample,
        artifacts: [{ submissionNumber: 1, type: 'JSON_SNAPSHOT' }]
      },
      false
    ],
    ['valid amended draft', amendedDraftExample, true],
    [
      'invalid amended draft without prior submission evidence',
      { ...amendedDraftExample, artifacts: [] },
      false
    ],
    ['valid submitted state', submittedExample, true],
    [
      'invalid submitted state with zero submissions',
      { ...submittedExample, numberOfSubmissions: 0 },
      false
    ],
    [
      'invalid submitted state with unsubmitted changes',
      { ...submittedExample, hasUnsubmittedChanges: true },
      false
    ],
    ['valid completed state', completeExample, true],
    [
      'invalid completed state without completion metadata',
      { ...completeExample, completedAt: null },
      false
    ],
    [
      'invalid completed state without prior submission evidence',
      { ...completeExample, artifacts: [] },
      false
    ],
    [
      'unknown persisted status',
      { ...newDraftExample, status: 'NOT_A_STATUS' },
      false
    ],
    [
      'persisted Amended status',
      { ...newDraftExample, status: 'AMENDED' },
      false
    ],
    [
      'persisted edit-specific status',
      { ...newDraftExample, status: 'DRAFT_EDIT' },
      false
    ]
  ])('Should classify "%s" as valid=%s', (_name, record, expectedValid) => {
    expect(checkLifecycleInvariants(record).valid).toBe(expectedValid)
  })

  test('Should reject a malformed root', () => {
    expect(checkLifecycleInvariants('not-an-object').valid).toBe(false)
    expect(checkLifecycleInvariants(undefined).valid).toBe(false)
  })

  test('Should not trust an inherited status property', () => {
    const record = Object.create({ status: 'DRAFT' })
    record.numberOfSubmissions = 0

    expect(checkLifecycleInvariants(record).valid).toBe(false)
  })

  test('Should not mutate the input', () => {
    const inputCopy = JSON.parse(JSON.stringify(submittedExample))
    checkLifecycleInvariants(submittedExample)

    expect(submittedExample).toEqual(inputCopy)
  })

  test('Should be deterministic', () => {
    expect(checkLifecycleInvariants(submittedExample)).toEqual(
      checkLifecycleInvariants(submittedExample)
    )
  })
})

describe('#lifecycle-consistency architecture boundary', () => {
  test('Should not import Hapi, Boom, Joi, or MongoDB', () => {
    const source = readFileSync(
      new URL('./lifecycle-consistency.js', import.meta.url),
      'utf8'
    )

    expect(source).not.toMatch(/from\s+['"]@hapi\/hapi['"]/)
    expect(source).not.toMatch(/from\s+['"]@hapi\/boom['"]/)
    expect(source).not.toMatch(/from\s+['"]joi['"]/)
    expect(source).not.toMatch(/from\s+['"]mongodb['"]/)
  })
})
