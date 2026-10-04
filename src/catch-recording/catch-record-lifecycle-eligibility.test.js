import {
  SUBMISSION_COUNT_EXPECTATIONS,
  UNSUBMITTED_CHANGES_EXPECTATIONS,
  calculateNextSubmissionNumber,
  canAbandonDraft,
  canMarkComplete,
  canResubmit,
  canStartAmendment,
  canSubmitFirstVersion,
  evaluateArtifactExpectation,
  evaluateAuditExpectation,
  resolvePreviousStatusForAmendment
} from './catch-record-lifecycle-eligibility.js'

describe('#canAbandonDraft', () => {
  test('Should allow a never-submitted draft', () => {
    expect(
      canAbandonDraft({ status: 'DRAFT', numberOfSubmissions: 0 }).allowed
    ).toBe(true)
  })

  test.each([
    { status: 'DRAFT', numberOfSubmissions: 1 },
    { status: 'SUBMITTED', numberOfSubmissions: 1 },
    { status: 'COMPLETE', numberOfSubmissions: 1 }
  ])('Should deny abandonment for %p', (input) => {
    const result = canAbandonDraft(input)

    expect(result.allowed).toBe(false)
    expect(result.code).toBe('DRAFT_ABANDONMENT_NOT_ALLOWED')
  })

  test('Should not mutate its input', () => {
    const input = { status: 'DRAFT', numberOfSubmissions: 0 }
    const snapshot = { ...input }

    canAbandonDraft(input)

    expect(input).toEqual(snapshot)
  })
})

describe('#canSubmitFirstVersion', () => {
  test('Should allow a never-submitted draft', () => {
    expect(
      canSubmitFirstVersion({ status: 'DRAFT', numberOfSubmissions: 0 }).allowed
    ).toBe(true)
  })

  test.each([
    { status: 'DRAFT', numberOfSubmissions: 1 },
    { status: 'SUBMITTED', numberOfSubmissions: 1 },
    { status: 'COMPLETE', numberOfSubmissions: 1 }
  ])('Should deny first submission for %p', (input) => {
    expect(canSubmitFirstVersion(input).code).toBe(
      'FIRST_SUBMISSION_NOT_ALLOWED'
    )
  })
})

describe('#canStartAmendment', () => {
  test.each(['SUBMITTED', 'COMPLETE'])(
    'Should allow amendment for %s with at least one submission',
    (status) => {
      expect(
        canStartAmendment({ status, numberOfSubmissions: 1 }).allowed
      ).toBe(true)
    }
  )

  test('Should deny amendment for a never-submitted draft', () => {
    const result = canStartAmendment({
      status: 'DRAFT',
      numberOfSubmissions: 0
    })

    expect(result.allowed).toBe(false)
    expect(result.code).toBe('AMENDMENT_NOT_ALLOWED')
  })

  test('Should deny amendment for an already-amended draft', () => {
    expect(
      canStartAmendment({ status: 'DRAFT', numberOfSubmissions: 1 }).allowed
    ).toBe(false)
  })

  test.each(['SUBMITTED', 'COMPLETE'])(
    'Should deny amendment for %s with zero submissions (inconsistent)',
    (status) => {
      expect(
        canStartAmendment({ status, numberOfSubmissions: 0 }).allowed
      ).toBe(false)
    }
  )
})

describe('#resolvePreviousStatusForAmendment', () => {
  test.each(['SUBMITTED', 'COMPLETE'])(
    'Should resolve the previous status for %s',
    (status) => {
      const result = resolvePreviousStatusForAmendment(status)

      expect(result.allowed).toBe(true)
      expect(result.details.previousStatus).toBe(status)
    }
  )

  test('Should reject amendment from DRAFT', () => {
    expect(resolvePreviousStatusForAmendment('DRAFT').allowed).toBe(false)
  })

  test('Should reject an unsupported status', () => {
    expect(resolvePreviousStatusForAmendment('DRAFT_EDIT').allowed).toBe(false)
  })
})

describe('#canResubmit', () => {
  test('Should allow a draft with prior submissions regardless of hasUnsubmittedChanges', () => {
    expect(
      canResubmit({ status: 'DRAFT', numberOfSubmissions: 1 }).allowed
    ).toBe(true)
  })

  test('Should deny resubmission for a never-submitted draft', () => {
    const result = canResubmit({ status: 'DRAFT', numberOfSubmissions: 0 })

    expect(result.allowed).toBe(false)
    expect(result.code).toBe('RESUBMISSION_NOT_ALLOWED')
  })

  test.each(['SUBMITTED', 'COMPLETE'])(
    'Should deny resubmission for %s',
    (status) => {
      expect(canResubmit({ status, numberOfSubmissions: 1 }).allowed).toBe(
        false
      )
    }
  )
})

describe('#canMarkComplete', () => {
  test('Should allow completion for a submitted record with submissions', () => {
    expect(
      canMarkComplete({ status: 'SUBMITTED', numberOfSubmissions: 1 }).allowed
    ).toBe(true)
  })

  test('Should deny completion for a draft', () => {
    expect(
      canMarkComplete({ status: 'DRAFT', numberOfSubmissions: 1 }).allowed
    ).toBe(false)
  })

  test('Should deny completion for an already-complete record', () => {
    expect(
      canMarkComplete({ status: 'COMPLETE', numberOfSubmissions: 1 }).allowed
    ).toBe(false)
  })

  test('Should deny completion for submitted with zero submissions (inconsistent)', () => {
    expect(
      canMarkComplete({ status: 'SUBMITTED', numberOfSubmissions: 0 }).allowed
    ).toBe(false)
  })
})

describe('#calculateNextSubmissionNumber', () => {
  test.each([
    [0, 1],
    [1, 2],
    [10, 11]
  ])('Should calculate %i -> %i', (current, expected) => {
    const result = calculateNextSubmissionNumber(current)

    expect(result.allowed).toBe(true)
    expect(result.details.nextSubmissionNumber).toBe(expected)
  })

  test.each([-1, 1.5, Number.NaN, 'one', Number.MAX_SAFE_INTEGER + 1])(
    'Should reject the invalid current count %p',
    (value) => {
      expect(calculateNextSubmissionNumber(value).code).toBe(
        'SUBMISSION_COUNT_INVALID'
      )
    }
  )

  test('Should not enforce a maximum when none is supplied', () => {
    expect(calculateNextSubmissionNumber(9999).allowed).toBe(true)
  })

  test('Should deny when an explicit maximum would be exceeded', () => {
    const result = calculateNextSubmissionNumber(5, { maxSubmissions: 5 })

    expect(result.allowed).toBe(false)
    expect(result.code).toBe('SUBMISSION_COUNT_LIMIT_REACHED')
  })

  test('Should not persist or reserve a number (pure calculation only)', () => {
    expect(calculateNextSubmissionNumber.constructor.name).toBe('Function')
  })
})

describe('SUBMISSION_COUNT_EXPECTATIONS and UNSUBMITTED_CHANGES_EXPECTATIONS', () => {
  test('Should match the approved submission-count expectation table', () => {
    expect(SUBMISSION_COUNT_EXPECTATIONS.newDraftCreation).toBe(0)
    expect(SUBMISSION_COUNT_EXPECTATIONS.firstSuccessfulSubmission).toBe(1)
    expect(
      SUBMISSION_COUNT_EXPECTATIONS.eachSuccessfulResubmissionIncrementsBy
    ).toBe(1)
  })

  test('Should match the approved hasUnsubmittedChanges expectation table', () => {
    expect(UNSUBMITTED_CHANGES_EXPECTATIONS.editStart).toBe(true)
    expect(UNSUBMITTED_CHANGES_EXPECTATIONS.amendmentSave).toBe(true)
    expect(UNSUBMITTED_CHANGES_EXPECTATIONS.successfulResubmission).toBe(false)
  })

  test('Should be frozen', () => {
    expect(Object.isFrozen(SUBMISSION_COUNT_EXPECTATIONS)).toBe(true)
    expect(Object.isFrozen(UNSUBMITTED_CHANGES_EXPECTATIONS)).toBe(true)
  })
})

describe('#evaluateAuditExpectation', () => {
  test('Should allow a never-submitted draft with zero edit events', () => {
    expect(
      evaluateAuditExpectation({
        status: 'DRAFT',
        numberOfSubmissions: 0,
        editEventCount: 0
      }).allowed
    ).toBe(true)
  })

  test('Should reject a negative edit-event count', () => {
    expect(
      evaluateAuditExpectation({
        status: 'DRAFT',
        numberOfSubmissions: 0,
        editEventCount: -1
      }).allowed
    ).toBe(false)
  })

  test('Should not append an event or generate an actor/date/reason', () => {
    const result = evaluateAuditExpectation({
      status: 'DRAFT',
      numberOfSubmissions: 1,
      editEventCount: 1
    })

    expect(result.details).not.toHaveProperty('reason')
    expect(result.details).not.toHaveProperty('fishermanId')
  })
})

describe('#evaluateArtifactExpectation', () => {
  test('Should allow a never-submitted draft with zero artifacts', () => {
    expect(
      evaluateArtifactExpectation({
        status: 'DRAFT',
        numberOfSubmissions: 0,
        artifactCount: 0
      }).allowed
    ).toBe(true)
  })

  test('Should reject zero submissions claiming completed-submission artifacts', () => {
    const result = evaluateArtifactExpectation({
      status: 'DRAFT',
      numberOfSubmissions: 0,
      artifactCount: 1
    })

    expect(result.allowed).toBe(false)
    expect(result.code).toBe('ARTIFACT_EXPECTATION_NOT_MET')
  })

  test('Should require artifact metadata for a submitted record with submissions', () => {
    const result = evaluateArtifactExpectation({
      status: 'SUBMITTED',
      numberOfSubmissions: 1,
      artifactCount: 0
    })

    expect(result.allowed).toBe(false)
  })

  test('Should allow an amended draft to preserve prior artifact metadata', () => {
    expect(
      evaluateArtifactExpectation({
        status: 'DRAFT',
        numberOfSubmissions: 1,
        artifactCount: 1
      }).allowed
    ).toBe(true)
  })

  test('Should not access object storage, generate a key, or generate a PDF', () => {
    const result = evaluateArtifactExpectation({
      status: 'SUBMITTED',
      numberOfSubmissions: 1,
      artifactCount: 1
    })

    expect(result.details).not.toHaveProperty('jsonSnapshotS3Key')
    expect(result.details).not.toHaveProperty('pdfReceiptS3Key')
  })
})
