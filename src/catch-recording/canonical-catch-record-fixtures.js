// Canonical Catch Record Object v1 — synthetic fixture builders (Step 05).
//
// Every builder returns a freshly constructed, independent object graph: no nested array or object is
// shared by reference between separate calls, or between the draft and submitted fixtures. All
// identifiers, names and actor values are synthetic placeholders — never real fisher, skipper, owner or
// vessel data. Fixtures are test-support data only; they are never imported by runtime application code
// (see canonical-catch-record-contract.test.js's companion architecture-boundary test in
// catch-recording-composition.test.js, which scans every non-test file in this directory).
function buildSpeciesAttribute(overrides = {}) {
  return {
    attributeId: 'fixture-attribute-1',
    nameSnapshot: 'Fixture attribute',
    value: 'fixture-value',
    ...overrides
  }
}

function buildSpeciesCaught(overrides = {}) {
  return {
    speciesId: 'fixture-species-1',
    faoCodeSnapshot: 'COD',
    nameSnapshot: 'Fixture Cod',
    attributes: [buildSpeciesAttribute()],
    ...overrides
  }
}

function buildGear(overrides = {}) {
  return {
    gearId: 'fixture-gear-1',
    associationId: 'fixture-association-1',
    codeSnapshot: 'GN',
    nameSnapshot: 'Fixture Gillnet',
    characteristics: [
      {
        characteristicId: 'fixture-characteristic-1',
        nameSnapshot: 'Mesh size',
        value: '120mm'
      }
    ],
    statisticalArea: {
      id: 'fixture-area-1',
      code: '27',
      nameSnapshot: 'Fixture Area 27'
    },
    speciesCaught: [buildSpeciesCaught()],
    ...overrides
  }
}

// Minimal incomplete draft: an unstarted gear journey, with vessel/trip/pairFishing/retainedCatch not yet
// selected. Deliberately does not satisfy any future complete-record (Step 07) rule.
export function createDraftCatchRecordFixture(overrides = {}) {
  return {
    id: null,
    catchRecordReference: null,
    ownerUserId: 'fixture-owner-1',
    status: 'DRAFT',
    version: 1,
    numberOfSubmissions: 0,
    hasUnsubmittedChanges: false,
    vessel: null,
    trip: null,
    pairFishing: null,
    gear: [],
    retainedCatch: null,
    audit: { editEvents: [] },
    artifacts: [],
    createdAt: '2026-01-01T09:00:00.000Z',
    createdBy: 'fixture-owner-1',
    updatedAt: '2026-01-01T09:00:00.000Z',
    updatedBy: 'fixture-owner-1',
    submittedAt: null,
    submittedBy: null,
    completedAt: null,
    completedBy: null,
    ...overrides
  }
}

// Representative complete/submitted example: two independent gears, each with its own statistical area,
// each containing at least one species. The same species identifier ("fixture-species-1") deliberately
// appears under both gears, each with its own independent, non-shared attributes array, to demonstrate the
// approved canonical hierarchy (species are per-gear, not globally unique across the catch record).
export function createSubmittedCatchRecordFixture(overrides = {}) {
  return {
    id: 'fixture-record-1',
    catchRecordReference: 'GBR-B14974-011026-095421',
    ownerUserId: 'fixture-owner-1',
    status: 'SUBMITTED',
    version: 2,
    numberOfSubmissions: 1,
    hasUnsubmittedChanges: false,
    vessel: {
      id: 'fixture-vessel-1',
      nameSnapshot: 'Fixture Vessel',
      registrationSnapshot: 'FIX-REG-1',
      externalMarkSnapshot: 'FIX-EM-1',
      lengthOverallMetres: 12.5
    },
    trip: {
      startedAndFinishedToday: true,
      dateStarted: '2026-01-01',
      dateEnded: '2026-01-01',
      departurePort: {
        id: 'fixture-port-1',
        codeSnapshot: 'GBPLY',
        nameSnapshot: 'Fixture Plymouth'
      },
      returnPort: {
        id: 'fixture-port-1',
        codeSnapshot: 'GBPLY',
        nameSnapshot: 'Fixture Plymouth'
      }
    },
    pairFishing: {
      enabled: false,
      pairSkipperFullName: null,
      pairVesselRssNumber: null
    },
    gear: [
      buildGear(),
      buildGear({
        gearId: 'fixture-gear-2',
        associationId: 'fixture-association-2',
        codeSnapshot: 'OT',
        nameSnapshot: 'Fixture Otter trawl',
        statisticalArea: {
          id: 'fixture-area-2',
          code: '28',
          nameSnapshot: 'Fixture Area 28'
        },
        speciesCaught: [
          buildSpeciesCaught({
            attributes: [
              buildSpeciesAttribute({ attributeId: 'fixture-attribute-2' })
            ]
          })
        ]
      })
    ],
    retainedCatch: { answer: 'YES', species: [] },
    audit: {
      editEvents: [
        {
          dateEdited: '2026-01-03T09:00:00.000Z',
          fishermanId: 'fixture-owner-1',
          previousStatus: 'SUBMITTED',
          reason: 'Fixture amendment reason'
        }
      ]
    },
    artifacts: [
      {
        submissionNumber: 1,
        jsonSnapshotS3Key: 'fixtures/fixture-record-1/1.json',
        pdfReceiptS3Key: 'fixtures/fixture-record-1/1.pdf',
        submittedAt: '2026-01-02T09:00:00.000Z',
        submittedBy: 'fixture-owner-1'
      }
    ],
    createdAt: '2026-01-01T09:00:00.000Z',
    createdBy: 'fixture-owner-1',
    updatedAt: '2026-01-02T09:00:00.000Z',
    updatedBy: 'fixture-owner-1',
    submittedAt: '2026-01-02T09:00:00.000Z',
    submittedBy: 'fixture-owner-1',
    completedAt: null,
    completedBy: null,
    ...overrides
  }
}
