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
        section: 'gears',
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
})
