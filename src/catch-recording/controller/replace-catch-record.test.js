import { replaceCatchRecord } from './replace-catch-record.js'
import { ApplicationError } from '#/common/helpers/errors/application-error.js'

const OWNER_USER_ID = 'owner-1'
const RECORD_ID = 'record-1'
const EXISTING_GEAR_ASSOCIATION_ID = 'gear-assoc-1'

function buildFakeCollection() {
  const store = new Map()
  return {
    findOneAndUpdate: vi.fn(async (filter, update) => {
      for (const [id, document] of store.entries()) {
        const matches = Object.entries(filter).every(
          ([key, value]) => document[key] === value
        )
        if (matches) {
          const updated = { ...document, ...(update.$set ?? {}) }
          if (update.$inc) {
            for (const [key, amount] of Object.entries(update.$inc)) {
              updated[key] = (document[key] ?? 0) + amount
            }
          }
          store.set(id, updated)
          return updated
        }
      }
      return null
    }),
    findOne: vi.fn(async (filter) => {
      for (const document of store.values()) {
        if (
          Object.entries(filter).every(
            ([key, value]) => document[key] === value
          )
        ) {
          return document
        }
      }
      return null
    }),
    insertOne: vi.fn(async (document) => ({
      acknowledged: true,
      insertedId: 'history-1',
      ...document
    })),
    seed: (document) => store.set(document._id, document)
  }
}

function buildFakeDb() {
  const collections = {
    'catch-records': buildFakeCollection(),
    'catch-record-history': buildFakeCollection()
  }
  return { collection: (name) => collections[name], collections }
}

function existingDraft(overrides = {}) {
  return {
    _id: RECORD_ID,
    schemaVersion: 1,
    catchRecordReference: 'GBR-RSS123456-051026-113500',
    ownerUserId: OWNER_USER_ID,
    status: 'DRAFT',
    numberOfSubmissions: 0,
    hasUnsubmittedChanges: false,
    submittedAt: null,
    submittedBy: null,
    completedAt: null,
    completedBy: null,
    artifacts: [],
    version: 1,
    vessel: {
      id: 'vessel-1',
      rssSnapshot: 'RSS000000',
      nameSnapshot: 'Old Vessel'
    },
    trip: {},
    pairFishing: { enabled: false, pairVessel: null, pairSkipperName: null },
    gears: [
      {
        associationId: EXISTING_GEAR_ASSOCIATION_ID,
        gear: { id: 'gear-1', codeSnapshot: 'OLD', nameSnapshot: 'Old Gear' },
        characteristics: [],
        speciesCaught: []
      }
    ],
    speciesNotLanded: [],
    createdAt: '2026-10-05T10:35:00Z',
    createdBy: OWNER_USER_ID,
    updatedAt: '2026-10-05T10:35:00Z',
    updatedBy: OWNER_USER_ID,
    ...overrides
  }
}

function fakeReferenceDataClient({
  rssSnapshot = 'RSS123456',
  accessibleVesselIds = ['vessel-1']
} = {}) {
  return {
    listAccessibleVesselIds: vi.fn(async () => accessibleVesselIds),
    getVesselById: vi.fn(async (id) => ({
      id,
      status: 'active',
      name: 'Example Vessel',
      lengthOverallMetres: 9.5,
      identifiers: { registrationNumber: rssSnapshot, externalMark: 'PZ1' }
    })),
    getPortById: vi.fn(async (id) => ({
      id,
      code: '0349',
      name: 'Plymouth',
      active: true
    })),
    getGearById: vi.fn(async (id) => ({
      id,
      code: 'GEAR001',
      name: 'Otter trawl',
      active: true,
      characteristics: [
        { characteristicId: 'char-1', name: 'Mesh size', unit: 'mm' }
      ]
    })),
    getStatisticalAreaById: vi.fn(async (id) => ({
      id,
      code: '46F45',
      name: 'ICES 46F45'
    })),
    getSpeciesById: vi.fn(async (id) => ({
      id,
      faoCode: 'COD',
      scientificName: 'Gadus morhua',
      commonNames: [{ id: 'cn-1', countryCode: 'GB', name: 'Atlantic Cod' }],
      active: true
    }))
  }
}

function authenticationContext(userId = OWNER_USER_ID) {
  return Object.freeze({ userId, scopes: Object.freeze([]) })
}

function validPayload(overrides = {}) {
  return {
    vessel: { id: 'vessel-1' },
    trip: {
      startedAndFinishedToday: false,
      dateStarted: '2026-10-05',
      dateEnded: '2026-10-05',
      departurePort: { id: 'port-1' },
      returnPort: { id: 'port-1' }
    },
    pairFishing: { enabled: false },
    gears: [
      {
        associationId: EXISTING_GEAR_ASSOCIATION_ID,
        gear: { id: 'gear-1' },
        characteristics: [{ characteristicId: 'char-1', value: 2 }]
      }
    ],
    speciesNotLanded: [],
    ...overrides
  }
}

describe('#replaceCatchRecord', () => {
  test('replaces every client-owned section atomically, incrementing version exactly once', async () => {
    const db = buildFakeDb()
    db.collections['catch-records'].seed(existingDraft())

    const response = await replaceCatchRecord({
      db,
      referenceDataClient: fakeReferenceDataClient(),
      authenticationContext: authenticationContext(),
      catchRecordId: RECORD_ID,
      expectedVersion: 1,
      payload: validPayload(),
      businessTimezone: 'Europe/London'
    })

    expect(response.version).toBe(2)
    expect(response.savedSection).toBeNull()

    const updateCall =
      db.collections['catch-records'].findOneAndUpdate.mock.calls[0][1].$set
    expect(updateCall.vessel).toEqual({
      id: 'vessel-1',
      rssSnapshot: 'RSS123456',
      nameSnapshot: 'Example Vessel',
      externalMarkSnapshot: 'PZ1',
      lengthOverallMetresSnapshot: 9.5
    })
    expect(updateCall.trip.departurePort).toEqual({
      id: 'port-1',
      codeSnapshot: '0349',
      nameSnapshot: 'Plymouth'
    })
    expect(updateCall.gears).toHaveLength(1)
    expect(updateCall.gears[0].associationId).toBe(EXISTING_GEAR_ASSOCIATION_ID)
  })

  test('the atomic predicate matches id, owner, DRAFT, and expected version', async () => {
    const db = buildFakeDb()
    db.collections['catch-records'].seed(existingDraft())

    await replaceCatchRecord({
      db,
      referenceDataClient: fakeReferenceDataClient(),
      authenticationContext: authenticationContext(),
      catchRecordId: RECORD_ID,
      expectedVersion: 1,
      payload: validPayload(),
      businessTimezone: 'Europe/London'
    })

    const predicate =
      db.collections['catch-records'].findOneAndUpdate.mock.calls[0][0]
    expect(predicate).toEqual({
      _id: RECORD_ID,
      ownerUserId: OWNER_USER_ID,
      status: 'DRAFT',
      version: 1
    })
  })

  test('retains the existing gear association id and generates a new one for an added gear', async () => {
    const db = buildFakeDb()
    db.collections['catch-records'].seed(existingDraft())

    await replaceCatchRecord({
      db,
      referenceDataClient: fakeReferenceDataClient(),
      authenticationContext: authenticationContext(),
      catchRecordId: RECORD_ID,
      expectedVersion: 1,
      payload: validPayload({
        gears: [
          {
            associationId: EXISTING_GEAR_ASSOCIATION_ID,
            gear: { id: 'gear-1' },
            characteristics: [{ characteristicId: 'char-1', value: 2 }]
          },
          {
            gear: { id: 'gear-1' },
            characteristics: [{ characteristicId: 'char-1', value: 3 }]
          }
        ]
      }),
      businessTimezone: 'Europe/London'
    })

    const updateCall =
      db.collections['catch-records'].findOneAndUpdate.mock.calls[0][1].$set
    expect(updateCall.gears).toHaveLength(2)
    expect(updateCall.gears[0].associationId).toBe(EXISTING_GEAR_ASSOCIATION_ID)
    expect(updateCall.gears[1].associationId).toBeTypeOf('string')
    expect(updateCall.gears[1].associationId).not.toBe(
      EXISTING_GEAR_ASSOCIATION_ID
    )
  })

  test('removes an omitted gear association (complete-replacement semantics)', async () => {
    const db = buildFakeDb()
    db.collections['catch-records'].seed(existingDraft())

    await replaceCatchRecord({
      db,
      referenceDataClient: fakeReferenceDataClient(),
      authenticationContext: authenticationContext(),
      catchRecordId: RECORD_ID,
      expectedVersion: 1,
      payload: validPayload({ gears: [] }),
      businessTimezone: 'Europe/London'
    })

    const updateCall =
      db.collections['catch-records'].findOneAndUpdate.mock.calls[0][1].$set
    expect(updateCall.gears).toEqual([])
  })

  test('rejects a forged/unknown gear association id', async () => {
    const db = buildFakeDb()
    db.collections['catch-records'].seed(existingDraft())

    await expect(
      replaceCatchRecord({
        db,
        referenceDataClient: fakeReferenceDataClient(),
        authenticationContext: authenticationContext(),
        catchRecordId: RECORD_ID,
        expectedVersion: 1,
        payload: validPayload({
          gears: [
            {
              associationId: 'forged-association-id',
              gear: { id: 'gear-1' },
              characteristics: [{ characteristicId: 'char-1', value: 2 }]
            }
          ]
        }),
        businessTimezone: 'Europe/London'
      })
    ).rejects.toMatchObject({ category: 'BUSINESS_VALIDATION_FAILURE' })

    expect(
      db.collections['catch-records'].findOneAndUpdate
    ).not.toHaveBeenCalled()
  })

  test('strips any server-owned field even if present in the supplied payload (defence in depth)', async () => {
    const db = buildFakeDb()
    db.collections['catch-records'].seed(existingDraft())

    await replaceCatchRecord({
      db,
      referenceDataClient: fakeReferenceDataClient(),
      authenticationContext: authenticationContext(),
      catchRecordId: RECORD_ID,
      expectedVersion: 1,
      payload: {
        ...validPayload(),
        status: 'SUBMITTED',
        version: 99,
        ownerUserId: 'someone-else',
        numberOfSubmissions: 5
      },
      businessTimezone: 'Europe/London'
    })

    const updateCall =
      db.collections['catch-records'].findOneAndUpdate.mock.calls[0][1].$set
    expect(updateCall.status).toBeUndefined()
    expect(updateCall.version).toBeUndefined()
    expect(updateCall.ownerUserId).toBeUndefined()
    expect(updateCall.numberOfSubmissions).toBeUndefined()
  })

  test('appends exactly one COMPLETE_REPLACEMENT_SAVED history event on success', async () => {
    const db = buildFakeDb()
    db.collections['catch-records'].seed(existingDraft())

    await replaceCatchRecord({
      db,
      referenceDataClient: fakeReferenceDataClient(),
      authenticationContext: authenticationContext(),
      catchRecordId: RECORD_ID,
      expectedVersion: 1,
      payload: validPayload(),
      businessTimezone: 'Europe/London'
    })

    expect(
      db.collections['catch-record-history'].insertOne
    ).toHaveBeenCalledTimes(1)
    const historyInsert =
      db.collections['catch-record-history'].insertOne.mock.calls[0][0]
    expect(historyInsert.eventType).toBe('COMPLETE_REPLACEMENT_SAVED')
    expect(historyInsert.actorUserId).toBe(OWNER_USER_ID)
  })

  test('throws RESOURCE_NOT_FOUND for a missing record', async () => {
    const db = buildFakeDb()

    await expect(
      replaceCatchRecord({
        db,
        referenceDataClient: fakeReferenceDataClient(),
        authenticationContext: authenticationContext(),
        catchRecordId: 'does-not-exist',
        expectedVersion: 1,
        payload: validPayload(),
        businessTimezone: 'Europe/London'
      })
    ).rejects.toMatchObject({ category: 'RESOURCE_NOT_FOUND' })
  })

  test('throws the identical RESOURCE_NOT_FOUND for another owner (no disclosure)', async () => {
    const db = buildFakeDb()
    db.collections['catch-records'].seed(existingDraft())

    await expect(
      replaceCatchRecord({
        db,
        referenceDataClient: fakeReferenceDataClient(),
        authenticationContext: authenticationContext('someone-else'),
        catchRecordId: RECORD_ID,
        expectedVersion: 1,
        payload: validPayload(),
        businessTimezone: 'Europe/London'
      })
    ).rejects.toMatchObject({ category: 'RESOURCE_NOT_FOUND' })
  })

  test('throws INVALID_LIFECYCLE_TRANSITION for a SUBMITTED record without any reference-data call', async () => {
    const db = buildFakeDb()
    db.collections['catch-records'].seed(
      existingDraft({
        status: 'SUBMITTED',
        numberOfSubmissions: 1,
        submittedAt: '2026-10-05T12:00:00Z',
        submittedBy: OWNER_USER_ID
      })
    )
    const referenceDataClient = fakeReferenceDataClient()

    await expect(
      replaceCatchRecord({
        db,
        referenceDataClient,
        authenticationContext: authenticationContext(),
        catchRecordId: RECORD_ID,
        expectedVersion: 1,
        payload: validPayload(),
        businessTimezone: 'Europe/London'
      })
    ).rejects.toMatchObject({
      category: 'INVALID_LIFECYCLE_TRANSITION',
      code: 'CATCH_RECORD_REPLACEMENT_INELIGIBLE'
    })

    expect(referenceDataClient.getVesselById).not.toHaveBeenCalled()
    expect(
      db.collections['catch-records'].findOneAndUpdate
    ).not.toHaveBeenCalled()
  })

  test('throws INVALID_LIFECYCLE_TRANSITION for a COMPLETE record', async () => {
    const db = buildFakeDb()
    db.collections['catch-records'].seed(existingDraft({ status: 'COMPLETE' }))

    await expect(
      replaceCatchRecord({
        db,
        referenceDataClient: fakeReferenceDataClient(),
        authenticationContext: authenticationContext(),
        catchRecordId: RECORD_ID,
        expectedVersion: 1,
        payload: validPayload(),
        businessTimezone: 'Europe/London'
      })
    ).rejects.toMatchObject({ category: 'INVALID_LIFECYCLE_TRANSITION' })
  })

  test('throws VERSION_CONFLICT for a stale expected version, performing no mutation', async () => {
    const db = buildFakeDb()
    db.collections['catch-records'].seed(existingDraft({ version: 2 }))

    await expect(
      replaceCatchRecord({
        db,
        referenceDataClient: fakeReferenceDataClient(),
        authenticationContext: authenticationContext(),
        catchRecordId: RECORD_ID,
        expectedVersion: 1,
        payload: validPayload(),
        businessTimezone: 'Europe/London'
      })
    ).rejects.toMatchObject({ category: 'VERSION_CONFLICT' })

    expect(
      db.collections['catch-record-history'].insertOne
    ).not.toHaveBeenCalled()
  })

  test('throws BUSINESS_VALIDATION_FAILURE for an enabled pairFishing section missing required details', async () => {
    const db = buildFakeDb()
    db.collections['catch-records'].seed(existingDraft())

    await expect(
      replaceCatchRecord({
        db,
        referenceDataClient: fakeReferenceDataClient(),
        authenticationContext: authenticationContext(),
        catchRecordId: RECORD_ID,
        expectedVersion: 1,
        payload: validPayload({ pairFishing: { enabled: true } }),
        businessTimezone: 'Europe/London'
      })
    ).rejects.toMatchObject({ category: 'BUSINESS_VALIDATION_FAILURE' })

    expect(
      db.collections['catch-records'].findOneAndUpdate
    ).not.toHaveBeenCalled()
  })

  test('throws AUTHORISATION_FAILURE when the caller cannot access the vessel', async () => {
    const db = buildFakeDb()
    db.collections['catch-records'].seed(existingDraft())

    await expect(
      replaceCatchRecord({
        db,
        referenceDataClient: fakeReferenceDataClient({
          accessibleVesselIds: []
        }),
        authenticationContext: authenticationContext(),
        catchRecordId: RECORD_ID,
        expectedVersion: 1,
        payload: validPayload(),
        businessTimezone: 'Europe/London'
      })
    ).rejects.toMatchObject({ category: 'AUTHORISATION_FAILURE' })
  })

  test('throws BUSINESS_VALIDATION_FAILURE when the vessel cannot be found', async () => {
    const db = buildFakeDb()
    db.collections['catch-records'].seed(existingDraft())
    const referenceDataClient = {
      ...fakeReferenceDataClient(),
      getVesselById: vi.fn(async () => {
        throw new ApplicationError({
          category: 'RESOURCE_NOT_FOUND',
          code: 'VESSEL_NOT_FOUND',
          message: 'Vessel not found.'
        })
      })
    }

    await expect(
      replaceCatchRecord({
        db,
        referenceDataClient,
        authenticationContext: authenticationContext(),
        catchRecordId: RECORD_ID,
        expectedVersion: 1,
        payload: validPayload(),
        businessTimezone: 'Europe/London'
      })
    ).rejects.toMatchObject({ category: 'BUSINESS_VALIDATION_FAILURE' })
  })

  test('throws BUSINESS_VALIDATION_FAILURE when a trip port cannot be found', async () => {
    const db = buildFakeDb()
    db.collections['catch-records'].seed(existingDraft())
    const referenceDataClient = {
      ...fakeReferenceDataClient(),
      getPortById: vi.fn(async () => {
        throw new ApplicationError({
          category: 'RESOURCE_NOT_FOUND',
          code: 'PORT_NOT_FOUND',
          message: 'Port not found.'
        })
      })
    }

    await expect(
      replaceCatchRecord({
        db,
        referenceDataClient,
        authenticationContext: authenticationContext(),
        catchRecordId: RECORD_ID,
        expectedVersion: 1,
        payload: validPayload(),
        businessTimezone: 'Europe/London'
      })
    ).rejects.toMatchObject({ category: 'BUSINESS_VALIDATION_FAILURE' })

    expect(
      db.collections['catch-records'].findOneAndUpdate
    ).not.toHaveBeenCalled()
  })

  test('applies the trusted business date and discards client-supplied dates when started and finished today', async () => {
    const db = buildFakeDb()
    db.collections['catch-records'].seed(existingDraft())

    await replaceCatchRecord({
      db,
      referenceDataClient: fakeReferenceDataClient(),
      authenticationContext: authenticationContext(),
      catchRecordId: RECORD_ID,
      expectedVersion: 1,
      payload: validPayload({
        trip: {
          startedAndFinishedToday: true,
          dateStarted: '1999-01-01',
          dateEnded: '1999-01-01',
          departurePort: { id: 'port-1' },
          returnPort: { id: 'port-1' }
        }
      }),
      businessTimezone: 'Europe/London'
    })

    const updateCall =
      db.collections['catch-records'].findOneAndUpdate.mock.calls[0][1].$set
    expect(updateCall.trip.dateStarted).not.toBe('1999-01-01')
    expect(updateCall.trip.dateStarted).toBe(updateCall.trip.dateEnded)
  })
})
