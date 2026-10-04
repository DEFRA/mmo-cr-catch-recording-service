import {
  CANONICAL_CATCH_RECORD_CONTRACT_VERSION,
  catchRecordSchemaV1,
  validateCatchRecordStructureV1
} from './canonical-catch-record-contract.js'

function buildMinimalGear(overrides = {}) {
  return {
    gearId: 'gear-1',
    associationId: 'assoc-1',
    codeSnapshot: 'GN',
    nameSnapshot: 'Gillnet',
    characteristics: [],
    statisticalArea: { id: 'area-1', code: '27', nameSnapshot: 'Area 27' },
    speciesCaught: [
      {
        speciesId: 'species-1',
        faoCodeSnapshot: 'COD',
        nameSnapshot: 'Cod',
        attributes: []
      }
    ],
    ...overrides
  }
}

function buildCompleteCandidate(overrides = {}) {
  return {
    id: 'record-1',
    catchRecordReference: 'GBR-B14974-011026-095421',
    ownerUserId: 'owner-1',
    status: 'SUBMITTED',
    version: 2,
    numberOfSubmissions: 1,
    hasUnsubmittedChanges: false,
    vessel: {
      id: 'vessel-1',
      nameSnapshot: 'Example Vessel',
      registrationSnapshot: 'REG-1',
      externalMarkSnapshot: 'EM-1',
      lengthOverallMetres: 12.5
    },
    gear: [
      buildMinimalGear(),
      buildMinimalGear({
        gearId: 'gear-2',
        associationId: 'assoc-2',
        statisticalArea: { id: 'area-2', code: '28', nameSnapshot: 'Area 28' }
      })
    ],
    retainedCatch: { answer: 'YES', species: [] },
    artifacts: [
      {
        submissionNumber: 1,
        jsonSnapshotS3Key: 'snapshots/record-1/1.json',
        pdfReceiptS3Key: 'receipts/record-1/1.pdf',
        submittedAt: '2026-01-01T00:00:00.000Z',
        submittedBy: 'user-1'
      }
    ],
    ...overrides
  }
}

describe('Contract versioning', () => {
  test('Should expose an explicit v1 contract-version identity', () => {
    expect(CANONICAL_CATCH_RECORD_CONTRACT_VERSION).toBe('v1')
  })

  test('Should not confuse the contract version with the concurrency "version" field', () => {
    const { value } = validateCatchRecordStructureV1({ version: 7 })

    expect(value.version).toBe(7)
    expect(CANONICAL_CATCH_RECORD_CONTRACT_VERSION).toBe('v1')
  })

  test('Should not expose an unapproved persisted schemaVersion property', () => {
    const { value } = validateCatchRecordStructureV1({})

    expect(value).not.toHaveProperty('schemaVersion')
  })
})

describe('Persisted statuses', () => {
  test.each(['DRAFT', 'SUBMITTED', 'COMPLETE'])(
    'Should accept the approved status "%s"',
    (status) => {
      const { error } = validateCatchRecordStructureV1({ status })

      expect(error).toBeUndefined()
    }
  )

  test.each(['DRAFT_EDIT', 'AMENDED', 'ABANDONED', 'WITHDRAWN', 'unknown'])(
    'Should reject the unsupported status "%s"',
    (status) => {
      const { error } = validateCatchRecordStructureV1({ status })

      expect(error).toBeDefined()
    }
  )
})

describe('Draft representation', () => {
  test('Should accept a representative incomplete draft', () => {
    const { error, value } = validateCatchRecordStructureV1({})

    expect(error).toBeUndefined()
    expect(value.gear).toEqual([])
    expect(value.vessel).toBeNull()
    expect(value.trip).toBeNull()
  })

  test('Should not automatically invalidate a draft for unvisited future sections', () => {
    const { error } = validateCatchRecordStructureV1({
      status: 'DRAFT',
      vessel: null,
      trip: null,
      pairFishing: null,
      gear: [],
      retainedCatch: null
    })

    expect(error).toBeUndefined()
  })

  test('Should accept draft-nullable lifecycle metadata', () => {
    const { error } = validateCatchRecordStructureV1({
      submittedAt: null,
      submittedBy: null,
      completedAt: null,
      completedBy: null
    })

    expect(error).toBeUndefined()
  })

  test('Should accept an empty gear collection before the gear journey is completed', () => {
    const { error, value } = validateCatchRecordStructureV1({ gear: [] })

    expect(error).toBeUndefined()
    expect(value.gear).toEqual([])
  })
})

describe('Canonical hierarchy', () => {
  test('Should accept a statistical area beneath a gear', () => {
    const { error } = validateCatchRecordStructureV1(buildCompleteCandidate())

    expect(error).toBeUndefined()
  })

  test('Should reject a root-level statisticalArea property', () => {
    const { error } = validateCatchRecordStructureV1(
      buildCompleteCandidate({ statisticalArea: { id: 'area-1' } })
    )

    expect(error).toBeDefined()
    expect(error.message).toContain('statisticalArea')
  })

  test('Should reject a root-level speciesCaught collection', () => {
    const { error } = validateCatchRecordStructureV1(
      buildCompleteCandidate({ speciesCaught: [] })
    )

    expect(error).toBeDefined()
    expect(error.message).toContain('speciesCaught')
  })

  test('Should accept gear characteristics beneath the relevant gear', () => {
    const { error } = validateCatchRecordStructureV1(
      buildCompleteCandidate({
        gear: [
          buildMinimalGear({
            characteristics: [
              {
                characteristicId: 'char-1',
                nameSnapshot: 'Mesh size',
                value: '120mm'
              }
            ]
          })
        ]
      })
    )

    expect(error).toBeUndefined()
  })

  test('Should accept species attributes beneath the relevant gear-specific species', () => {
    const { error } = validateCatchRecordStructureV1(
      buildCompleteCandidate({
        gear: [
          buildMinimalGear({
            speciesCaught: [
              {
                speciesId: 'species-1',
                faoCodeSnapshot: 'COD',
                nameSnapshot: 'Cod',
                attributes: [
                  {
                    attributeId: 'attr-1',
                    nameSnapshot: 'Weight band',
                    value: 'A'
                  }
                ]
              }
            ]
          })
        ]
      })
    )

    expect(error).toBeUndefined()
  })

  test('Should allow two gears to have different statistical areas', () => {
    const { value, error } = validateCatchRecordStructureV1(
      buildCompleteCandidate()
    )

    expect(error).toBeUndefined()
    expect(value.gear[0].statisticalArea.id).toBe('area-1')
    expect(value.gear[1].statisticalArea.id).toBe('area-2')
    expect(value.gear[0].statisticalArea).not.toBe(
      value.gear[1].statisticalArea
    )
  })

  test('Should allow the same species identifier beneath two different gears', () => {
    const { value, error } = validateCatchRecordStructureV1(
      buildCompleteCandidate()
    )

    expect(error).toBeUndefined()
    expect(value.gear[0].speciesCaught[0].speciesId).toBe('species-1')
    expect(value.gear[1].speciesCaught[0].speciesId).toBe('species-1')
  })
})

describe('Nested contracts', () => {
  test('Should accept the approved vessel snapshot fields', () => {
    const { error } = validateCatchRecordStructureV1(buildCompleteCandidate())

    expect(error).toBeUndefined()
  })

  test('Should accept the approved port snapshot fields', () => {
    const { error } = validateCatchRecordStructureV1(
      buildCompleteCandidate({
        trip: {
          startedAndFinishedToday: true,
          dateStarted: '2026-01-01',
          dateEnded: '2026-01-01',
          departurePort: {
            id: 'port-1',
            codeSnapshot: 'GBPLY',
            nameSnapshot: 'Plymouth'
          },
          returnPort: {
            id: 'port-1',
            codeSnapshot: 'GBPLY',
            nameSnapshot: 'Plymouth'
          }
        }
      })
    )

    expect(error).toBeUndefined()
  })

  test('Should accept the approved pair fishing fields', () => {
    const { error } = validateCatchRecordStructureV1(
      buildCompleteCandidate({
        pairFishing: {
          enabled: true,
          pairSkipperFullName: 'Example Skipper',
          pairVesselRssNumber: 'B99999'
        }
      })
    )

    expect(error).toBeUndefined()
  })

  test('Should distinguish gearId and associationId', () => {
    const { value } = validateCatchRecordStructureV1(buildCompleteCandidate())

    expect(value.gear[0].gearId).toBe('gear-1')
    expect(value.gear[0].associationId).toBe('assoc-1')
    expect(value.gear[0].gearId).not.toBe(value.gear[0].associationId)
  })

  test('Should accept retained catch using only the approved confirmed fields', () => {
    const { error } = validateCatchRecordStructureV1(
      buildCompleteCandidate({ retainedCatch: { answer: 'NO', species: [] } })
    )

    expect(error).toBeUndefined()
  })

  test('Should reject an invented retainedCatch field', () => {
    const { error } = validateCatchRecordStructureV1(
      buildCompleteCandidate({
        retainedCatch: { answer: 'YES', species: [], invented: true }
      })
    )

    expect(error).toBeDefined()
  })

  test('Should accept an untyped, non-empty retainedCatch.species array', () => {
    const { error } = validateCatchRecordStructureV1(
      buildCompleteCandidate({
        retainedCatch: {
          answer: 'YES',
          species: [{ anything: 'is permitted for now' }]
        }
      })
    )

    expect(error).toBeUndefined()
  })

  test('Should accept approved audit edit event fields', () => {
    const { error } = validateCatchRecordStructureV1(
      buildCompleteCandidate({
        audit: {
          editEvents: [
            {
              dateEdited: '2026-01-02T00:00:00.000Z',
              fishermanId: 'fisherman-1',
              previousStatus: 'SUBMITTED',
              reason: 'Correcting species details'
            }
          ]
        }
      })
    )

    expect(error).toBeUndefined()
  })

  test('Should reject an audit edit event with an unsupported previousStatus', () => {
    const { error } = validateCatchRecordStructureV1(
      buildCompleteCandidate({
        audit: {
          editEvents: [
            {
              dateEdited: '2026-01-02T00:00:00.000Z',
              fishermanId: 'fisherman-1',
              previousStatus: 'DRAFT_EDIT',
              reason: 'Invalid'
            }
          ]
        }
      })
    )

    expect(error).toBeDefined()
  })

  test('Should accept the approved artifact metadata fields', () => {
    const { error } = validateCatchRecordStructureV1(buildCompleteCandidate())

    expect(error).toBeUndefined()
  })

  test('Should accept lifecycle timestamps and actor metadata', () => {
    const { error } = validateCatchRecordStructureV1(
      buildCompleteCandidate({
        createdAt: '2026-01-01T00:00:00.000Z',
        createdBy: 'user-1',
        updatedAt: '2026-01-01T00:00:00.000Z',
        updatedBy: 'user-1'
      })
    )

    expect(error).toBeUndefined()
  })
})

describe('Submission and completion metadata', () => {
  test('Should accept null submission metadata before submission', () => {
    const { error } = validateCatchRecordStructureV1({
      submittedAt: null,
      submittedBy: null
    })

    expect(error).toBeUndefined()
  })

  test('Should accept null completion metadata before completion', () => {
    const { error } = validateCatchRecordStructureV1({
      completedAt: null,
      completedBy: null
    })

    expect(error).toBeUndefined()
  })

  test('Should support multiple artifact submission versions', () => {
    const { error, value } = validateCatchRecordStructureV1(
      buildCompleteCandidate({
        artifacts: [
          {
            submissionNumber: 1,
            jsonSnapshotS3Key: 'snapshots/record-1/1.json',
            pdfReceiptS3Key: 'receipts/record-1/1.pdf',
            submittedAt: '2026-01-01T00:00:00.000Z',
            submittedBy: 'user-1'
          },
          {
            submissionNumber: 2,
            jsonSnapshotS3Key: 'snapshots/record-1/2.json',
            pdfReceiptS3Key: 'receipts/record-1/2.pdf',
            submittedAt: '2026-01-05T00:00:00.000Z',
            submittedBy: 'user-1'
          }
        ]
      })
    )

    expect(error).toBeUndefined()
    expect(value.artifacts).toHaveLength(2)
  })

  test('Should reject an audit edit event previousStatus outside the approved statuses', () => {
    const { error } = validateCatchRecordStructureV1(
      buildCompleteCandidate({
        audit: {
          editEvents: [
            {
              dateEdited: '2026-01-02T00:00:00.000Z',
              fishermanId: 'fisherman-1',
              previousStatus: 'AMENDED',
              reason: 'Invalid'
            }
          ]
        }
      })
    )

    expect(error).toBeDefined()
  })
})

describe('Unknown and invalid properties', () => {
  test('Should reject an unknown top-level property', () => {
    const { error } = validateCatchRecordStructureV1({ unknownField: true })

    expect(error).toBeDefined()
  })

  test('Should reject an unknown nested gear property', () => {
    const { error } = validateCatchRecordStructureV1(
      buildCompleteCandidate({
        gear: [buildMinimalGear({ unknownField: true })]
      })
    )

    expect(error).toBeDefined()
  })

  test('Should fail deterministically on an invalid calendar date', () => {
    const { error } = validateCatchRecordStructureV1({
      trip: { dateStarted: '01-01-2026' }
    })

    expect(error).toBeDefined()
  })

  test('Should not throw on an invalid nested shape', () => {
    expect(() =>
      validateCatchRecordStructureV1({ gear: [{ gearId: 123 }] })
    ).not.toThrow()
  })

  test('Should not mutate the caller-owned input candidate', () => {
    const candidate = buildCompleteCandidate()
    const snapshot = JSON.parse(JSON.stringify(candidate))

    validateCatchRecordStructureV1(candidate)

    expect(candidate).toEqual(snapshot)
  })
})

describe('Architecture boundary', () => {
  test('Should not import Hapi, Boom, Convict, MongoDB or infrastructure SDKs', async () => {
    const { readFileSync } = await import('node:fs')
    const { fileURLToPath } = await import('node:url')

    const source = readFileSync(
      fileURLToPath(
        new URL('./canonical-catch-record-contract.js', import.meta.url)
      ),
      'utf8'
    )

    for (const token of [
      '@hapi/hapi',
      '@hapi/boom',
      "from 'convict'",
      "from 'mongodb'",
      '@aws-sdk'
    ]) {
      expect(source).not.toContain(token)
    }
  })

  test('Should expose the schema itself for advanced composition', () => {
    expect(catchRecordSchemaV1).toBeDefined()
    expect(typeof catchRecordSchemaV1.validate).toBe('function')
  })
})
