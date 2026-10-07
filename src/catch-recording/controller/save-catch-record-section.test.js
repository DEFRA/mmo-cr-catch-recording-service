import { randomUUID } from 'node:crypto'

import { saveCatchRecordSection } from './save-catch-record-section.js'

const OWNER_USER_ID = 'owner-1'
const RECORD_ID = 'record-1'

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
    insertOne: vi.fn(async (document) => {
      const id = document._id ?? randomUUID()
      store.set(id, { ...document, _id: id })
      return { acknowledged: true, insertedId: id }
    }),
    seed: (document) => store.set(document._id, document),
    store
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
    version: 1,
    vessel: { id: 'vessel-1' },
    trip: {},
    pairFishing: { enabled: false, pairVessel: null, pairSkipperName: null },
    gears: [],
    ...overrides
  }
}

function fakeReferenceDataClient() {
  return {
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

describe('#saveCatchRecordSection', () => {
  test('saves a trip section with manual dates and resolves both ports', async () => {
    const db = buildFakeDb()
    db.collections['catch-records'].seed(existingDraft())

    const response = await saveCatchRecordSection({
      db,
      referenceDataClient: fakeReferenceDataClient(),
      authenticationContext: authenticationContext(),
      catchRecordId: RECORD_ID,
      expectedVersion: 1,
      section: 'trip',
      data: {
        startedAndFinishedToday: false,
        dateStarted: '2026-10-01',
        dateEnded: '2026-10-02',
        departurePort: { id: 'port-1' },
        returnPort: { id: 'port-2' }
      },
      businessTimezone: 'Europe/London'
    })

    expect(response.savedSection).toBe('trip')
    expect(response.version).toBe(2)

    const updateCall =
      db.collections['catch-records'].findOneAndUpdate.mock.calls[0][1].$set
    expect(updateCall.trip.dateStarted).toBe('2026-10-01')
    expect(updateCall.trip.departurePort).toEqual({
      id: 'port-1',
      codeSnapshot: '0349',
      nameSnapshot: 'Plymouth'
    })
  })

  test('applies the trusted business date and discards client dates when started and finished today', async () => {
    const db = buildFakeDb()
    db.collections['catch-records'].seed(existingDraft())

    await saveCatchRecordSection({
      db,
      referenceDataClient: fakeReferenceDataClient(),
      authenticationContext: authenticationContext(),
      catchRecordId: RECORD_ID,
      expectedVersion: 1,
      section: 'trip',
      data: {
        startedAndFinishedToday: true,
        dateStarted: '1999-01-01',
        departurePort: { id: 'port-1' },
        returnPort: { id: 'port-1' }
      },
      businessTimezone: 'Europe/London'
    })

    const updateCall =
      db.collections['catch-records'].findOneAndUpdate.mock.calls[0][1].$set
    expect(updateCall.trip.dateStarted).not.toBe('1999-01-01')
    expect(updateCall.trip.dateStarted).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(updateCall.trip.dateStarted).toBe(updateCall.trip.dateEnded)
  })

  test('saves a disabled pairFishing section', async () => {
    const db = buildFakeDb()
    db.collections['catch-records'].seed(existingDraft())

    const response = await saveCatchRecordSection({
      db,
      referenceDataClient: fakeReferenceDataClient(),
      authenticationContext: authenticationContext(),
      catchRecordId: RECORD_ID,
      expectedVersion: 1,
      section: 'pairFishing',
      data: { enabled: false },
      businessTimezone: 'Europe/London'
    })

    expect(response.savedSection).toBe('pairFishing')
  })

  test('saves an enabled pairFishing section with both required details', async () => {
    const db = buildFakeDb()
    db.collections['catch-records'].seed(existingDraft())

    const response = await saveCatchRecordSection({
      db,
      referenceDataClient: fakeReferenceDataClient(),
      authenticationContext: authenticationContext(),
      catchRecordId: RECORD_ID,
      expectedVersion: 1,
      section: 'pairFishing',
      data: {
        enabled: true,
        pairVessel: 'Other Vessel',
        pairSkipperName: 'Jane Doe'
      },
      businessTimezone: 'Europe/London'
    })

    expect(response.sectionCompletion.pairFishing).toBe(true)
  })

  test('leaves unrelated sections (e.g. vessel) unchanged when saving pairFishing', async () => {
    const db = buildFakeDb()
    db.collections['catch-records'].seed(existingDraft())

    await saveCatchRecordSection({
      db,
      referenceDataClient: fakeReferenceDataClient(),
      authenticationContext: authenticationContext(),
      catchRecordId: RECORD_ID,
      expectedVersion: 1,
      section: 'pairFishing',
      data: { enabled: false },
      businessTimezone: 'Europe/London'
    })

    const updateCall =
      db.collections['catch-records'].findOneAndUpdate.mock.calls[0][1].$set
    expect(updateCall.vessel).toBeUndefined()
    expect(updateCall.trip).toBeUndefined()
  })

  test('appends a SECTION_SAVED history event naming the saved section', async () => {
    const db = buildFakeDb()
    db.collections['catch-records'].seed(existingDraft())

    await saveCatchRecordSection({
      db,
      referenceDataClient: fakeReferenceDataClient(),
      authenticationContext: authenticationContext(),
      catchRecordId: RECORD_ID,
      expectedVersion: 1,
      section: 'pairFishing',
      data: { enabled: false },
      businessTimezone: 'Europe/London'
    })

    const historyInsert =
      db.collections['catch-record-history'].insertOne.mock.calls[0][0]
    expect(historyInsert.eventType).toBe('SECTION_SAVED')
    expect(historyInsert.metadata).toEqual({ section: 'pairFishing' })
  })

  test('appends an AMENDMENT_SECTION_SAVED history event (not SECTION_SAVED) when saving a section of an amended draft', async () => {
    const db = buildFakeDb()
    db.collections['catch-records'].seed(
      existingDraft({
        numberOfSubmissions: 1,
        hasUnsubmittedChanges: true,
        submittedAt: '2026-10-05T10:00:00Z',
        submittedBy: OWNER_USER_ID,
        artifacts: [
          { submissionNumber: 1, type: 'JSON_SNAPSHOT' },
          { submissionNumber: 1, type: 'PDF_RECEIPT' }
        ]
      })
    )

    const response = await saveCatchRecordSection({
      db,
      referenceDataClient: fakeReferenceDataClient(),
      authenticationContext: authenticationContext(),
      catchRecordId: RECORD_ID,
      expectedVersion: 1,
      section: 'pairFishing',
      data: { enabled: false },
      businessTimezone: 'Europe/London'
    })

    expect(response.status).toBe('DRAFT')
    expect(response.displayStatus).toBe('Amended')

    const historyInsert =
      db.collections['catch-record-history'].insertOne.mock.calls[0][0]
    expect(historyInsert.eventType).toBe('AMENDMENT_SECTION_SAVED')
    expect(historyInsert.metadata).toEqual({ section: 'pairFishing' })
  })

  test('preserves hasUnsubmittedChanges = true and prior artifacts through an amendment-save', async () => {
    const db = buildFakeDb()
    db.collections['catch-records'].seed(
      existingDraft({
        numberOfSubmissions: 1,
        hasUnsubmittedChanges: true,
        artifacts: [
          { submissionNumber: 1, type: 'JSON_SNAPSHOT' },
          { submissionNumber: 1, type: 'PDF_RECEIPT' }
        ]
      })
    )

    await saveCatchRecordSection({
      db,
      referenceDataClient: fakeReferenceDataClient(),
      authenticationContext: authenticationContext(),
      catchRecordId: RECORD_ID,
      expectedVersion: 1,
      section: 'pairFishing',
      data: { enabled: false },
      businessTimezone: 'Europe/London'
    })

    const stored = db.collections['catch-records'].store.get(RECORD_ID)
    expect(stored.hasUnsubmittedChanges).toBe(true)
    expect(stored.artifacts).toEqual([
      { submissionNumber: 1, type: 'JSON_SNAPSHOT' },
      { submissionNumber: 1, type: 'PDF_RECEIPT' }
    ])
    expect(stored.numberOfSubmissions).toBe(1)
  })

  test('rejects a section save on a SUBMITTED record (must edit-start first)', async () => {
    const db = buildFakeDb()
    db.collections['catch-records'].seed(
      existingDraft({ status: 'SUBMITTED', numberOfSubmissions: 1 })
    )

    await expect(
      saveCatchRecordSection({
        db,
        referenceDataClient: fakeReferenceDataClient(),
        authenticationContext: authenticationContext(),
        catchRecordId: RECORD_ID,
        expectedVersion: 1,
        section: 'pairFishing',
        data: { enabled: false },
        businessTimezone: 'Europe/London'
      })
    ).rejects.toMatchObject({
      category: 'INVALID_LIFECYCLE_TRANSITION',
      code: 'CATCH_RECORD_SECTION_UPDATE_INELIGIBLE'
    })
  })

  test('rejects a section save on a COMPLETE record (must edit-start first)', async () => {
    const db = buildFakeDb()
    db.collections['catch-records'].seed(
      existingDraft({ status: 'COMPLETE', numberOfSubmissions: 1 })
    )

    await expect(
      saveCatchRecordSection({
        db,
        referenceDataClient: fakeReferenceDataClient(),
        authenticationContext: authenticationContext(),
        catchRecordId: RECORD_ID,
        expectedVersion: 1,
        section: 'pairFishing',
        data: { enabled: false },
        businessTimezone: 'Europe/London'
      })
    ).rejects.toMatchObject({ code: 'CATCH_RECORD_SECTION_UPDATE_INELIGIBLE' })
  })

  test('rejects an unsupported section name', async () => {
    const db = buildFakeDb()
    db.collections['catch-records'].seed(existingDraft())

    await expect(
      saveCatchRecordSection({
        db,
        referenceDataClient: fakeReferenceDataClient(),
        authenticationContext: authenticationContext(),
        catchRecordId: RECORD_ID,
        expectedVersion: 1,
        section: 'notASupportedSection',
        data: {},
        businessTimezone: 'Europe/London'
      })
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_SECTION' })
  })

  test('rejects an invalid trip payload with BUSINESS_VALIDATION_FAILURE', async () => {
    const db = buildFakeDb()
    db.collections['catch-records'].seed(existingDraft())

    await expect(
      saveCatchRecordSection({
        db,
        referenceDataClient: fakeReferenceDataClient(),
        authenticationContext: authenticationContext(),
        catchRecordId: RECORD_ID,
        expectedVersion: 1,
        section: 'trip',
        data: { startedAndFinishedToday: false },
        businessTimezone: 'Europe/London'
      })
    ).rejects.toMatchObject({ category: 'BUSINESS_VALIDATION_FAILURE' })
  })

  test('rejects a port that cannot be found with BUSINESS_VALIDATION_FAILURE', async () => {
    const db = buildFakeDb()
    db.collections['catch-records'].seed(existingDraft())
    const { ApplicationError } =
      await import('#/common/helpers/errors/application-error.js')
    const referenceDataClient = {
      getPortById: vi.fn(async () => {
        throw new ApplicationError({
          category: 'RESOURCE_NOT_FOUND',
          message: 'The selected port could not be found.'
        })
      })
    }

    await expect(
      saveCatchRecordSection({
        db,
        referenceDataClient,
        authenticationContext: authenticationContext(),
        catchRecordId: RECORD_ID,
        expectedVersion: 1,
        section: 'trip',
        data: {
          startedAndFinishedToday: true,
          departurePort: { id: 'missing-port' },
          returnPort: { id: 'missing-port' }
        },
        businessTimezone: 'Europe/London'
      })
    ).rejects.toMatchObject({ category: 'BUSINESS_VALIDATION_FAILURE' })
  })

  test('rejects a missing catch record with RESOURCE_NOT_FOUND', async () => {
    const db = buildFakeDb()

    await expect(
      saveCatchRecordSection({
        db,
        referenceDataClient: fakeReferenceDataClient(),
        authenticationContext: authenticationContext(),
        catchRecordId: 'does-not-exist',
        expectedVersion: 1,
        section: 'pairFishing',
        data: { enabled: false },
        businessTimezone: 'Europe/London'
      })
    ).rejects.toMatchObject({ category: 'RESOURCE_NOT_FOUND' })
  })

  test('rejects a stale expected version with VERSION_CONFLICT', async () => {
    const db = buildFakeDb()
    db.collections['catch-records'].seed(existingDraft({ version: 2 }))

    await expect(
      saveCatchRecordSection({
        db,
        referenceDataClient: fakeReferenceDataClient(),
        authenticationContext: authenticationContext(),
        catchRecordId: RECORD_ID,
        expectedVersion: 1,
        section: 'pairFishing',
        data: { enabled: false },
        businessTimezone: 'Europe/London'
      })
    ).rejects.toMatchObject({ category: 'VERSION_CONFLICT' })
  })

  test('does not mutate the supplied data input', async () => {
    const db = buildFakeDb()
    db.collections['catch-records'].seed(existingDraft())
    const input = Object.freeze({ enabled: false })

    await expect(
      saveCatchRecordSection({
        db,
        referenceDataClient: fakeReferenceDataClient(),
        authenticationContext: authenticationContext(),
        catchRecordId: RECORD_ID,
        expectedVersion: 1,
        section: 'pairFishing',
        data: input,
        businessTimezone: 'Europe/London'
      })
    ).resolves.toBeDefined()
  })

  describe('gears section', () => {
    function existingGear(overrides = {}) {
      return {
        associationId: 'gear-assoc-1',
        gear: {
          id: 'gear-1',
          codeSnapshot: 'OLD_CODE',
          nameSnapshot: 'Old Name'
        },
        characteristics: [],
        statisticalArea: {
          id: 'area-1',
          codeSnapshot: 'A1',
          nameSnapshot: 'Area One'
        },
        speciesCaught: [
          {
            associationId: 'species-assoc-1',
            species: {
              id: 'species-1',
              faoCodeSnapshot: 'COD',
              nameSnapshot: 'Cod'
            },
            catchDetails: []
          }
        ],
        ...overrides
      }
    }

    test('saves a new gear occurrence with a server-generated associationId', async () => {
      const db = buildFakeDb()
      db.collections['catch-records'].seed(existingDraft())

      const response = await saveCatchRecordSection({
        db,
        referenceDataClient: fakeReferenceDataClient(),
        authenticationContext: authenticationContext(),
        catchRecordId: RECORD_ID,
        expectedVersion: 1,
        section: 'gears',
        data: [
          {
            gear: { id: 'gear-1' },
            characteristics: [
              {
                characteristicId: 'char-1',
                value: 80,
                unitSnapshot: 'client-supplied'
              }
            ]
          }
        ],
        businessTimezone: 'Europe/London'
      })

      expect(response.savedSection).toBe('gears')
      expect(response.version).toBe(2)

      const updateCall =
        db.collections['catch-records'].findOneAndUpdate.mock.calls[0][1].$set
      expect(updateCall.gears).toHaveLength(1)
      expect(typeof updateCall.gears[0].associationId).toBe('string')
      expect(updateCall.gears[0].associationId.length).toBeGreaterThan(0)
      expect(updateCall.gears[0].gear).toEqual({
        id: 'gear-1',
        codeSnapshot: 'GEAR001',
        nameSnapshot: 'Otter trawl'
      })
      expect(updateCall.gears[0].characteristics[0]).toMatchObject({
        characteristicId: 'char-1',
        value: 80
      })
      // the client-supplied unitSnapshot is discarded and replaced by the resolved snapshot
      expect(updateCall.gears[0].characteristics[0].unitSnapshot).toBe('mm')
      expect(updateCall.gears[0].speciesCaught).toEqual([])
    })

    test('retains an existing gear occurrence, preserving its nested statistical area and species data', async () => {
      const db = buildFakeDb()
      db.collections['catch-records'].seed(
        existingDraft({ gears: [existingGear()] })
      )

      await saveCatchRecordSection({
        db,
        referenceDataClient: fakeReferenceDataClient(),
        authenticationContext: authenticationContext(),
        catchRecordId: RECORD_ID,
        expectedVersion: 1,
        section: 'gears',
        data: [
          {
            associationId: 'gear-assoc-1',
            gear: { id: 'gear-1' },
            characteristics: []
          }
        ],
        businessTimezone: 'Europe/London'
      })

      const updateCall =
        db.collections['catch-records'].findOneAndUpdate.mock.calls[0][1].$set
      expect(updateCall.gears).toHaveLength(1)
      expect(updateCall.gears[0].associationId).toBe('gear-assoc-1')
      // refreshed from the resolved snapshot, not the stale persisted snapshot
      expect(updateCall.gears[0].gear.nameSnapshot).toBe('Otter trawl')
      expect(updateCall.gears[0].statisticalArea).toEqual(
        existingGear().statisticalArea
      )
      expect(updateCall.gears[0].speciesCaught).toEqual(
        existingGear().speciesCaught
      )
    })

    test('drops a deselected gear occurrence, cascading its nested dependent data', async () => {
      const db = buildFakeDb()
      db.collections['catch-records'].seed(
        existingDraft({
          gears: [
            existingGear({ associationId: 'gear-assoc-1' }),
            existingGear({
              associationId: 'gear-assoc-2',
              gear: { id: 'gear-2' }
            })
          ]
        })
      )

      await saveCatchRecordSection({
        db,
        referenceDataClient: fakeReferenceDataClient(),
        authenticationContext: authenticationContext(),
        catchRecordId: RECORD_ID,
        expectedVersion: 1,
        section: 'gears',
        data: [
          {
            associationId: 'gear-assoc-1',
            gear: { id: 'gear-1' },
            characteristics: []
          }
        ],
        businessTimezone: 'Europe/London'
      })

      const updateCall =
        db.collections['catch-records'].findOneAndUpdate.mock.calls[0][1].$set
      expect(updateCall.gears).toHaveLength(1)
      expect(updateCall.gears[0].associationId).toBe('gear-assoc-1')
      expect(
        updateCall.gears.some((gear) => gear.associationId === 'gear-assoc-2')
      ).toBe(false)
    })

    test('Step 24: sets a statistical area under the target gear, resolved fresh from the Reference Data Service', async () => {
      const db = buildFakeDb()
      db.collections['catch-records'].seed(
        existingDraft({ gears: [existingGear()] })
      )

      await saveCatchRecordSection({
        db,
        referenceDataClient: fakeReferenceDataClient(),
        authenticationContext: authenticationContext(),
        catchRecordId: RECORD_ID,
        expectedVersion: 1,
        section: 'gears',
        data: [
          {
            associationId: 'gear-assoc-1',
            gear: { id: 'gear-1' },
            characteristics: [],
            statisticalArea: {
              id: 'area-2',
              codeSnapshot: 'FORGED',
              nameSnapshot: 'Forged'
            }
          }
        ],
        businessTimezone: 'Europe/London'
      })

      const updateCall =
        db.collections['catch-records'].findOneAndUpdate.mock.calls[0][1].$set
      expect(updateCall.gears[0].statisticalArea).toEqual({
        id: 'area-2',
        codeSnapshot: '46F45',
        nameSnapshot: 'ICES 46F45'
      })
    })

    test('Step 24: clears a gear statistical area when the client supplies statisticalArea: null', async () => {
      const db = buildFakeDb()
      db.collections['catch-records'].seed(
        existingDraft({ gears: [existingGear()] })
      )

      await saveCatchRecordSection({
        db,
        referenceDataClient: fakeReferenceDataClient(),
        authenticationContext: authenticationContext(),
        catchRecordId: RECORD_ID,
        expectedVersion: 1,
        section: 'gears',
        data: [
          {
            associationId: 'gear-assoc-1',
            gear: { id: 'gear-1' },
            characteristics: [],
            statisticalArea: null
          }
        ],
        businessTimezone: 'Europe/London'
      })

      const updateCall =
        db.collections['catch-records'].findOneAndUpdate.mock.calls[0][1].$set
      expect(updateCall.gears[0].statisticalArea).toBeNull()
    })

    test('Step 24: rejects an invalid/not-found statistical area with BUSINESS_VALIDATION_FAILURE', async () => {
      const db = buildFakeDb()
      db.collections['catch-records'].seed(
        existingDraft({ gears: [existingGear()] })
      )
      const { ApplicationError } =
        await import('#/common/helpers/errors/application-error.js')
      const referenceDataClient = fakeReferenceDataClient()
      referenceDataClient.getStatisticalAreaById = vi.fn(async () => {
        throw new ApplicationError({
          category: 'RESOURCE_NOT_FOUND',
          message: 'The selected statistical area could not be found.'
        })
      })

      await expect(
        saveCatchRecordSection({
          db,
          referenceDataClient,
          authenticationContext: authenticationContext(),
          catchRecordId: RECORD_ID,
          expectedVersion: 1,
          section: 'gears',
          data: [
            {
              associationId: 'gear-assoc-1',
              gear: { id: 'gear-1' },
              characteristics: [],
              statisticalArea: { id: 'missing-area' }
            }
          ],
          businessTimezone: 'Europe/London'
        })
      ).rejects.toMatchObject({ category: 'BUSINESS_VALIDATION_FAILURE' })
    })

    test('Step 24: leaves every other gear association deeply unchanged when one gear gets a statistical area', async () => {
      const db = buildFakeDb()
      const untouchedGear = existingGear({
        associationId: 'gear-assoc-2',
        gear: {
          id: 'gear-2',
          codeSnapshot: 'GEAR001',
          nameSnapshot: 'Otter trawl'
        }
      })
      db.collections['catch-records'].seed(
        existingDraft({ gears: [existingGear(), untouchedGear] })
      )

      await saveCatchRecordSection({
        db,
        referenceDataClient: fakeReferenceDataClient(),
        authenticationContext: authenticationContext(),
        catchRecordId: RECORD_ID,
        expectedVersion: 1,
        section: 'gears',
        data: [
          {
            associationId: 'gear-assoc-1',
            gear: { id: 'gear-1' },
            characteristics: [],
            statisticalArea: { id: 'area-2' }
          },
          {
            associationId: 'gear-assoc-2',
            gear: { id: 'gear-2' },
            characteristics: []
          }
        ],
        businessTimezone: 'Europe/London'
      })

      const updateCall =
        db.collections['catch-records'].findOneAndUpdate.mock.calls[0][1].$set
      const gearTwo = updateCall.gears.find(
        (gear) => gear.associationId === 'gear-assoc-2'
      )
      expect(gearTwo.statisticalArea).toEqual(untouchedGear.statisticalArea)
      expect(gearTwo.speciesCaught).toEqual(untouchedGear.speciesCaught)
    })

    test('Step 27: adds a new species entry with weight fields, resolved fresh from the Reference Data Service', async () => {
      const db = buildFakeDb()
      db.collections['catch-records'].seed(
        existingDraft({ gears: [existingGear({ speciesCaught: [] })] })
      )

      await saveCatchRecordSection({
        db,
        referenceDataClient: fakeReferenceDataClient(),
        authenticationContext: authenticationContext(),
        catchRecordId: RECORD_ID,
        expectedVersion: 1,
        section: 'gears',
        data: [
          {
            associationId: 'gear-assoc-1',
            gear: { id: 'gear-1' },
            characteristics: [],
            speciesCaught: [
              {
                id: 'species-1',
                name: 'FORGED',
                weightAboveMinimumKg: 5,
                weightPrecision: 'wholeNumber'
              }
            ]
          }
        ],
        businessTimezone: 'Europe/London'
      })

      const updateCall =
        db.collections['catch-records'].findOneAndUpdate.mock.calls[0][1].$set
      const speciesCaught = updateCall.gears[0].speciesCaught
      expect(speciesCaught).toEqual([
        {
          id: 'species-1',
          faoCodeSnapshot: 'COD',
          nameSnapshot: 'Atlantic Cod',
          weightAboveMinimumKg: 5,
          weightPrecision: 'wholeNumber'
        }
      ])
    })

    test("Step 27: replaces a gear's speciesCaught wholesale with whatever is supplied in the save", async () => {
      const db = buildFakeDb()
      db.collections['catch-records'].seed(
        existingDraft({ gears: [existingGear()] })
      )

      await saveCatchRecordSection({
        db,
        referenceDataClient: fakeReferenceDataClient(),
        authenticationContext: authenticationContext(),
        catchRecordId: RECORD_ID,
        expectedVersion: 1,
        section: 'gears',
        data: [
          {
            associationId: 'gear-assoc-1',
            gear: { id: 'gear-1' },
            characteristics: [],
            speciesCaught: [{ id: 'species-1', weightBelowMinimumKg: 2 }]
          }
        ],
        businessTimezone: 'Europe/London'
      })

      const updateCall =
        db.collections['catch-records'].findOneAndUpdate.mock.calls[0][1].$set
      const speciesCaught = updateCall.gears[0].speciesCaught
      expect(speciesCaught).toEqual([
        {
          id: 'species-1',
          faoCodeSnapshot: 'COD',
          nameSnapshot: 'Atlantic Cod',
          weightBelowMinimumKg: 2
        }
      ])
    })

    test('Step 25: drops a deselected species relationship from the target gear only', async () => {
      const db = buildFakeDb()
      db.collections['catch-records'].seed(
        existingDraft({ gears: [existingGear()] })
      )

      await saveCatchRecordSection({
        db,
        referenceDataClient: fakeReferenceDataClient(),
        authenticationContext: authenticationContext(),
        catchRecordId: RECORD_ID,
        expectedVersion: 1,
        section: 'gears',
        data: [
          {
            associationId: 'gear-assoc-1',
            gear: { id: 'gear-1' },
            characteristics: [],
            speciesCaught: []
          }
        ],
        businessTimezone: 'Europe/London'
      })

      const updateCall =
        db.collections['catch-records'].findOneAndUpdate.mock.calls[0][1].$set
      expect(updateCall.gears[0].speciesCaught).toEqual([])
    })

    test("Step 25: leaves a gear's species untouched when speciesCaught is omitted from the payload", async () => {
      const db = buildFakeDb()
      db.collections['catch-records'].seed(
        existingDraft({ gears: [existingGear()] })
      )

      await saveCatchRecordSection({
        db,
        referenceDataClient: fakeReferenceDataClient(),
        authenticationContext: authenticationContext(),
        catchRecordId: RECORD_ID,
        expectedVersion: 1,
        section: 'gears',
        data: [
          {
            associationId: 'gear-assoc-1',
            gear: { id: 'gear-1' },
            characteristics: []
          }
        ],
        businessTimezone: 'Europe/London'
      })

      const updateCall =
        db.collections['catch-records'].findOneAndUpdate.mock.calls[0][1].$set
      expect(updateCall.gears[0].speciesCaught).toEqual(
        existingGear().speciesCaught
      )
    })

    test('Step 27: permits the same authoritative species under two different gears independently', async () => {
      const db = buildFakeDb()
      db.collections['catch-records'].seed(
        existingDraft({
          gears: [
            existingGear({ associationId: 'gear-assoc-1', speciesCaught: [] }),
            existingGear({
              associationId: 'gear-assoc-2',
              gear: { id: 'gear-2' },
              speciesCaught: []
            })
          ]
        })
      )

      await saveCatchRecordSection({
        db,
        referenceDataClient: fakeReferenceDataClient(),
        authenticationContext: authenticationContext(),
        catchRecordId: RECORD_ID,
        expectedVersion: 1,
        section: 'gears',
        data: [
          {
            associationId: 'gear-assoc-1',
            gear: { id: 'gear-1' },
            characteristics: [],
            speciesCaught: [{ id: 'species-1', weightAboveMinimumKg: 1 }]
          },
          {
            associationId: 'gear-assoc-2',
            gear: { id: 'gear-2' },
            characteristics: [],
            speciesCaught: [{ id: 'species-1', weightAboveMinimumKg: 2 }]
          }
        ],
        businessTimezone: 'Europe/London'
      })

      const updateCall =
        db.collections['catch-records'].findOneAndUpdate.mock.calls[0][1].$set
      const gearOneSpecies = updateCall.gears.find(
        (gear) => gear.associationId === 'gear-assoc-1'
      ).speciesCaught[0]
      const gearTwoSpecies = updateCall.gears.find(
        (gear) => gear.associationId === 'gear-assoc-2'
      ).speciesCaught[0]

      expect(gearOneSpecies.id).toBe('species-1')
      expect(gearTwoSpecies.id).toBe('species-1')
      expect(gearOneSpecies.weightAboveMinimumKg).toBe(1)
      expect(gearTwoSpecies.weightAboveMinimumKg).toBe(2)
    })

    test('Step 27: rejects a duplicate authoritative species selected twice under the same gear', async () => {
      const db = buildFakeDb()
      db.collections['catch-records'].seed(
        existingDraft({ gears: [existingGear({ speciesCaught: [] })] })
      )

      await expect(
        saveCatchRecordSection({
          db,
          referenceDataClient: fakeReferenceDataClient(),
          authenticationContext: authenticationContext(),
          catchRecordId: RECORD_ID,
          expectedVersion: 1,
          section: 'gears',
          data: [
            {
              associationId: 'gear-assoc-1',
              gear: { id: 'gear-1' },
              characteristics: [],
              speciesCaught: [{ id: 'species-1' }, { id: 'species-1' }]
            }
          ],
          businessTimezone: 'Europe/London'
        })
      ).rejects.toMatchObject({
        category: 'BUSINESS_VALIDATION_FAILURE',
        code: 'SECTION_VALIDATION_FAILED'
      })
    })

    test('Step 25: rejects a species that cannot be resolved with BUSINESS_VALIDATION_FAILURE', async () => {
      const db = buildFakeDb()
      db.collections['catch-records'].seed(
        existingDraft({ gears: [existingGear({ speciesCaught: [] })] })
      )
      const { ApplicationError } =
        await import('#/common/helpers/errors/application-error.js')
      const referenceDataClient = fakeReferenceDataClient()
      referenceDataClient.getSpeciesById = vi.fn(async () => {
        throw new ApplicationError({
          category: 'RESOURCE_NOT_FOUND',
          message: 'The selected species could not be found.'
        })
      })

      await expect(
        saveCatchRecordSection({
          db,
          referenceDataClient,
          authenticationContext: authenticationContext(),
          catchRecordId: RECORD_ID,
          expectedVersion: 1,
          section: 'gears',
          data: [
            {
              associationId: 'gear-assoc-1',
              gear: { id: 'gear-1' },
              characteristics: [],
              speciesCaught: [{ id: 'missing-species' }]
            }
          ],
          businessTimezone: 'Europe/London'
        })
      ).rejects.toMatchObject({ category: 'BUSINESS_VALIDATION_FAILURE' })
    })

    test('Step 27: rejects a non-numeric weight field with BUSINESS_VALIDATION_FAILURE', async () => {
      const db = buildFakeDb()
      db.collections['catch-records'].seed(
        existingDraft({ gears: [existingGear({ speciesCaught: [] })] })
      )

      await expect(
        saveCatchRecordSection({
          db,
          referenceDataClient: fakeReferenceDataClient(),
          authenticationContext: authenticationContext(),
          catchRecordId: RECORD_ID,
          expectedVersion: 1,
          section: 'gears',
          data: [
            {
              associationId: 'gear-assoc-1',
              gear: { id: 'gear-1' },
              characteristics: [],
              speciesCaught: [{ id: 'species-1', weightAboveMinimumKg: 'lots' }]
            }
          ],
          businessTimezone: 'Europe/London'
        })
      ).rejects.toMatchObject({ category: 'BUSINESS_VALIDATION_FAILURE' })
    })

    test('rejects a gear that cannot be resolved with BUSINESS_VALIDATION_FAILURE', async () => {
      const db = buildFakeDb()
      db.collections['catch-records'].seed(existingDraft())
      const { ApplicationError } =
        await import('#/common/helpers/errors/application-error.js')
      const referenceDataClient = {
        getGearById: vi.fn(async () => {
          throw new ApplicationError({
            category: 'RESOURCE_NOT_FOUND',
            message: 'The selected gear could not be found.'
          })
        })
      }

      await expect(
        saveCatchRecordSection({
          db,
          referenceDataClient,
          authenticationContext: authenticationContext(),
          catchRecordId: RECORD_ID,
          expectedVersion: 1,
          section: 'gears',
          data: [{ gear: { id: 'missing-gear' } }],
          businessTimezone: 'Europe/London'
        })
      ).rejects.toMatchObject({ category: 'BUSINESS_VALIDATION_FAILURE' })
    })

    test('rejects an unknown/forged associationId with BUSINESS_VALIDATION_FAILURE (does not mint a new identity)', async () => {
      const db = buildFakeDb()
      db.collections['catch-records'].seed(existingDraft({ gears: [] }))

      await expect(
        saveCatchRecordSection({
          db,
          referenceDataClient: fakeReferenceDataClient(),
          authenticationContext: authenticationContext(),
          catchRecordId: RECORD_ID,
          expectedVersion: 1,
          section: 'gears',
          data: [{ associationId: 'unknown-assoc', gear: { id: 'gear-1' } }],
          businessTimezone: 'Europe/London'
        })
      ).rejects.toMatchObject({
        category: 'BUSINESS_VALIDATION_FAILURE',
        code: 'SECTION_VALIDATION_FAILED'
      })
    })

    test('rejects a missing catch record with RESOURCE_NOT_FOUND', async () => {
      const db = buildFakeDb()

      await expect(
        saveCatchRecordSection({
          db,
          referenceDataClient: fakeReferenceDataClient(),
          authenticationContext: authenticationContext(),
          catchRecordId: 'does-not-exist',
          expectedVersion: 1,
          section: 'gears',
          data: [],
          businessTimezone: 'Europe/London'
        })
      ).rejects.toMatchObject({ category: 'RESOURCE_NOT_FOUND' })
    })

    test('rejects a stale expected version with VERSION_CONFLICT', async () => {
      const db = buildFakeDb()
      db.collections['catch-records'].seed(existingDraft({ version: 2 }))

      await expect(
        saveCatchRecordSection({
          db,
          referenceDataClient: fakeReferenceDataClient(),
          authenticationContext: authenticationContext(),
          catchRecordId: RECORD_ID,
          expectedVersion: 1,
          section: 'gears',
          data: [],
          businessTimezone: 'Europe/London'
        })
      ).rejects.toMatchObject({ category: 'VERSION_CONFLICT' })
    })

    test('leaves unrelated sections (e.g. vessel, trip) unchanged when saving gears', async () => {
      const db = buildFakeDb()
      db.collections['catch-records'].seed(existingDraft())

      await saveCatchRecordSection({
        db,
        referenceDataClient: fakeReferenceDataClient(),
        authenticationContext: authenticationContext(),
        catchRecordId: RECORD_ID,
        expectedVersion: 1,
        section: 'gears',
        data: [{ gear: { id: 'gear-1' } }],
        businessTimezone: 'Europe/London'
      })

      const updateCall =
        db.collections['catch-records'].findOneAndUpdate.mock.calls[0][1].$set
      expect(updateCall.vessel).toBeUndefined()
      expect(updateCall.trip).toBeUndefined()
      expect(updateCall.pairFishing).toBeUndefined()
    })

    test('does not mutate the supplied gears data input', async () => {
      const db = buildFakeDb()
      db.collections['catch-records'].seed(existingDraft())
      const input = Object.freeze([
        Object.freeze({ gear: Object.freeze({ id: 'gear-1' }) })
      ])

      await expect(
        saveCatchRecordSection({
          db,
          referenceDataClient: fakeReferenceDataClient(),
          authenticationContext: authenticationContext(),
          catchRecordId: RECORD_ID,
          expectedVersion: 1,
          section: 'gears',
          data: input,
          businessTimezone: 'Europe/London'
        })
      ).resolves.toBeDefined()
    })

    test('appends a SECTION_SAVED history event naming the gears section', async () => {
      const db = buildFakeDb()
      db.collections['catch-records'].seed(existingDraft())

      await saveCatchRecordSection({
        db,
        referenceDataClient: fakeReferenceDataClient(),
        authenticationContext: authenticationContext(),
        catchRecordId: RECORD_ID,
        expectedVersion: 1,
        section: 'gears',
        data: [{ gear: { id: 'gear-1' } }],
        businessTimezone: 'Europe/London'
      })

      const historyInsert =
        db.collections['catch-record-history'].insertOne.mock.calls[0][0]
      expect(historyInsert.eventType).toBe('SECTION_SAVED')
      expect(historyInsert.metadata).toEqual({ section: 'gears' })
    })
  })

  describe('speciesNotLanded section', () => {
    test('Step 27: sets the root-level speciesNotLanded collection, resolved fresh from the Reference Data Service', async () => {
      const db = buildFakeDb()
      db.collections['catch-records'].seed(
        existingDraft({ speciesNotLanded: [] })
      )

      await saveCatchRecordSection({
        db,
        referenceDataClient: fakeReferenceDataClient(),
        authenticationContext: authenticationContext(),
        catchRecordId: RECORD_ID,
        expectedVersion: 1,
        section: 'speciesNotLanded',
        data: [
          {
            id: 'species-1',
            name: 'FORGED',
            weightLegallyDiscardedKg: 3,
            weightPrecision: 'oneDecimalPlace'
          }
        ],
        businessTimezone: 'Europe/London'
      })

      const updateCall =
        db.collections['catch-records'].findOneAndUpdate.mock.calls[0][1].$set
      expect(updateCall.speciesNotLanded).toEqual([
        {
          id: 'species-1',
          faoCodeSnapshot: 'COD',
          nameSnapshot: 'Atlantic Cod',
          weightLegallyDiscardedKg: 3,
          weightPrecision: 'oneDecimalPlace'
        }
      ])
    })

    test('Step 27: clears the speciesNotLanded collection with an empty array', async () => {
      const db = buildFakeDb()
      db.collections['catch-records'].seed(
        existingDraft({
          speciesNotLanded: [{ id: 'species-1', faoCodeSnapshot: 'COD' }]
        })
      )

      await saveCatchRecordSection({
        db,
        referenceDataClient: fakeReferenceDataClient(),
        authenticationContext: authenticationContext(),
        catchRecordId: RECORD_ID,
        expectedVersion: 1,
        section: 'speciesNotLanded',
        data: [],
        businessTimezone: 'Europe/London'
      })

      const updateCall =
        db.collections['catch-records'].findOneAndUpdate.mock.calls[0][1].$set
      expect(updateCall.speciesNotLanded).toEqual([])
    })

    test('Step 27: rejects a duplicate species id within speciesNotLanded with BUSINESS_VALIDATION_FAILURE', async () => {
      const db = buildFakeDb()
      db.collections['catch-records'].seed(
        existingDraft({ speciesNotLanded: [] })
      )

      await expect(
        saveCatchRecordSection({
          db,
          referenceDataClient: fakeReferenceDataClient(),
          authenticationContext: authenticationContext(),
          catchRecordId: RECORD_ID,
          expectedVersion: 1,
          section: 'speciesNotLanded',
          data: [{ id: 'species-1' }, { id: 'species-1' }],
          businessTimezone: 'Europe/London'
        })
      ).rejects.toMatchObject({
        category: 'BUSINESS_VALIDATION_FAILURE',
        code: 'SECTION_VALIDATION_FAILED'
      })
    })

    test('Step 27: rejects a speciesNotLanded entry that cannot be resolved with BUSINESS_VALIDATION_FAILURE', async () => {
      const db = buildFakeDb()
      db.collections['catch-records'].seed(
        existingDraft({ speciesNotLanded: [] })
      )
      const { ApplicationError } =
        await import('#/common/helpers/errors/application-error.js')
      const referenceDataClient = fakeReferenceDataClient()
      referenceDataClient.getSpeciesById = vi.fn(async () => {
        throw new ApplicationError({
          category: 'RESOURCE_NOT_FOUND',
          message: 'The selected species could not be found.'
        })
      })

      await expect(
        saveCatchRecordSection({
          db,
          referenceDataClient,
          authenticationContext: authenticationContext(),
          catchRecordId: RECORD_ID,
          expectedVersion: 1,
          section: 'speciesNotLanded',
          data: [{ id: 'missing-species' }],
          businessTimezone: 'Europe/London'
        })
      ).rejects.toMatchObject({ category: 'BUSINESS_VALIDATION_FAILURE' })
    })

    test('appends a SECTION_SAVED history event naming the speciesNotLanded section', async () => {
      const db = buildFakeDb()
      db.collections['catch-records'].seed(
        existingDraft({ speciesNotLanded: [] })
      )

      await saveCatchRecordSection({
        db,
        referenceDataClient: fakeReferenceDataClient(),
        authenticationContext: authenticationContext(),
        catchRecordId: RECORD_ID,
        expectedVersion: 1,
        section: 'speciesNotLanded',
        data: [],
        businessTimezone: 'Europe/London'
      })

      const historyInsert =
        db.collections['catch-record-history'].insertOne.mock.calls[0][0]
      expect(historyInsert.eventType).toBe('SECTION_SAVED')
      expect(historyInsert.metadata).toEqual({ section: 'speciesNotLanded' })
    })
  })
})
