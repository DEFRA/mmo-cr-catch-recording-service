import { CANONICAL_SCHEMA_VERSION } from '../canonical-catch-record.js'
import { PERSISTED_STATUSES } from '../lifecycle-status.js'

/**
 * Recursively freezes an object graph. Used only to make these shared fixtures safe for every
 * consuming test file to import without risk of one test's mutation leaking into another.
 *
 * @param {object} value
 */
function deepFreeze(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const key of Object.getOwnPropertyNames(value)) {
      deepFreeze(value[key])
    }
    Object.freeze(value)
  }
  return value
}

const GEAR_ASSOCIATION_ID = 'b5ca27d2-8e5f-4920-89a5-d4756829b44e'
const SPECIES_ID = '60628fcb-97af-40d0-b992-099216c8fc40'
const SHARED_USER_ID = 'e0ec9737-908e-4749-97e0-41caf19de2c2'
const FIRST_SUBMISSION_AT = '2026-10-05T12:15:00Z'

function baseGear() {
  return {
    associationId: GEAR_ASSOCIATION_ID,
    gear: {
      id: 'f3c85f59-1196-43da-b74b-909f7d7be451',
      codeSnapshot: 'TBB',
      nameSnapshot: 'Beam Trawl'
    },
    characteristics: [
      {
        characteristicId: 'number-of-times-gear-shot',
        nameSnapshot: 'Number of Times Gear Shot',
        value: 2
      },
      {
        characteristicId: 'cb6adafd-ce57-4960-95a8-5d463007e63f',
        nameSnapshot: 'Mesh Size',
        value: 9,
        unitSnapshot: 'mm'
      }
    ],
    statisticalArea: {
      id: '12639177-7614-4616-83cd-6141ecb83924',
      codeSnapshot: '46F45',
      nameSnapshot: 'ICES 46F45'
    },
    speciesCaught: [
      {
        id: SPECIES_ID,
        faoCodeSnapshot: 'COD',
        nameSnapshot: 'Atlantic Cod',
        weightAboveMinimumKg: 120.5,
        weightBelowMinimumKg: 4,
        weightLegallyDiscardedKg: null,
        weightPrecision: 'oneDecimalPlace'
      }
    ]
  }
}

function baseCatchRecord(overrides) {
  return {
    schemaVersion: CANONICAL_SCHEMA_VERSION,
    id: '5f9c6586-3bf0-4fbb-95d8-ef2cf9c1d9af',
    catchRecordReference: 'GBR-RSS123456-051026-113500',
    ownerUserId: SHARED_USER_ID,
    version: 1,
    vessel: {
      id: '0fe4d4aa-22f8-449e-89c9-b7052bae8667',
      rssSnapshot: 'RSS123456',
      nameSnapshot: 'EXAMPLE VESSEL',
      externalMarkSnapshot: 'PH123',
      lengthOverallMetresSnapshot: 8.74
    },
    trip: {
      startedAndFinishedToday: true,
      dateStarted: '2026-10-05',
      dateEnded: '2026-10-05',
      departurePort: {
        id: '462e3de0-8d5e-422a-aaed-220da112ca81',
        codeSnapshot: '0349',
        nameSnapshot: 'Plymouth'
      },
      returnPort: {
        id: '462e3de0-8d5e-422a-aaed-220da112ca81',
        codeSnapshot: '0349',
        nameSnapshot: 'Plymouth'
      }
    },
    pairFishing: {
      enabled: false,
      pairVessel: null,
      pairSkipperName: null
    },
    gears: [baseGear()],
    // `speciesNotLanded` is the one approved root-level species collection (Step 27 redesign,
    // service-owner decision): a single, trip-level list independent of any gear's `speciesCaught`.
    speciesNotLanded: [],
    artifacts: [],
    createdAt: '2026-10-05T10:35:00Z',
    createdBy: SHARED_USER_ID,
    updatedAt: '2026-10-05T10:35:00Z',
    updatedBy: SHARED_USER_ID,
    submittedAt: null,
    submittedBy: null,
    completedAt: null,
    completedBy: null,
    ...overrides
  }
}

/** A Catch Record that has never been submitted. */
export const newDraftExample = deepFreeze(
  baseCatchRecord({
    status: PERSISTED_STATUSES.DRAFT,
    numberOfSubmissions: 0,
    hasUnsubmittedChanges: false
  })
)

/** A Catch Record with exactly one successful submission and no further unsubmitted changes. */
export const submittedExample = deepFreeze(
  baseCatchRecord({
    status: PERSISTED_STATUSES.SUBMITTED,
    numberOfSubmissions: 1,
    hasUnsubmittedChanges: false,
    speciesNotLanded: [
      {
        id: 'WHG',
        faoCodeSnapshot: 'WHG',
        nameSnapshot: 'Whiting',
        weightAboveMinimumKg: 6.5,
        weightBelowMinimumKg: null,
        weightLegallyDiscardedKg: null,
        weightPrecision: 'oneDecimalPlace'
      }
    ],
    artifacts: [
      { submissionNumber: 1, type: 'JSON_SNAPSHOT' },
      { submissionNumber: 1, type: 'PDF_RECEIPT' }
    ],
    submittedAt: FIRST_SUBMISSION_AT,
    submittedBy: SHARED_USER_ID
  })
)

/**
 * An amended record: persisted status remains `DRAFT`, but `numberOfSubmissions > 0` means the
 * derived display status (owned by Step 08) is "Amended". Earlier submission artifacts are preserved
 * unchanged.
 */
export const amendedDraftExample = deepFreeze(
  baseCatchRecord({
    status: PERSISTED_STATUSES.DRAFT,
    numberOfSubmissions: 1,
    hasUnsubmittedChanges: true,
    artifacts: [
      { submissionNumber: 1, type: 'JSON_SNAPSHOT' },
      { submissionNumber: 1, type: 'PDF_RECEIPT' }
    ],
    submittedAt: FIRST_SUBMISSION_AT,
    submittedBy: SHARED_USER_ID
  })
)

/** A completed Catch Record. */
export const completeExample = deepFreeze(
  baseCatchRecord({
    status: PERSISTED_STATUSES.COMPLETE,
    numberOfSubmissions: 1,
    hasUnsubmittedChanges: false,
    artifacts: [
      { submissionNumber: 1, type: 'JSON_SNAPSHOT' },
      { submissionNumber: 1, type: 'PDF_RECEIPT' }
    ],
    submittedAt: FIRST_SUBMISSION_AT,
    submittedBy: SHARED_USER_ID,
    completedAt: '2026-10-06T09:00:00Z',
    completedBy: SHARED_USER_ID
  })
)
