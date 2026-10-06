import { retrieveCatchRecord } from './retrieve-catch-record.js'
import {
  newDraftExample,
  amendedDraftExample,
  submittedExample,
  completeExample
} from '#/catch-recording/domain/__fixtures__/canonical-catch-record.fixtures.js'

const OWNER_USER_ID = newDraftExample.ownerUserId

function buildFakeDb(documents) {
  const store = new Map(documents.map((document) => [document._id, document]))
  const collection = {
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
    })
  }
  return { collection: vi.fn(() => collection), _collection: collection }
}

function toDocument(canonicalRecord) {
  return { ...canonicalRecord, _id: canonicalRecord.id }
}

describe('retrieveCatchRecord', () => {
  test('returns the complete canonical record plus derived facts for an owner-authorised new draft', async () => {
    const db = buildFakeDb([toDocument(newDraftExample)])

    const result = await retrieveCatchRecord({
      db,
      authenticationContext: { userId: OWNER_USER_ID, scopes: [] },
      catchRecordId: newDraftExample.id
    })

    expect(result.id).toBe(newDraftExample.id)
    expect(result.catchRecordReference).toBe(
      newDraftExample.catchRecordReference
    )
    expect(result.vessel).toEqual(newDraftExample.vessel)
    expect(result.gears).toEqual(newDraftExample.gears)
    expect(result.displayStatus).toBe('Draft')
    expect(result.sectionCompletion).toEqual({
      trip: true,
      pairFishing: true,
      gears: true
    })
    expect([...result.completedSections].sort()).toEqual(
      ['gears', 'pairFishing', 'trip'].sort()
    )
    expect(result.incompleteSections).toEqual([])
    expect(result.progress).toEqual({
      hasUnsubmittedChanges: false,
      numberOfSubmissions: 0,
      incompleteGearAssociationIds: [],
      currentIncompleteGearAssociationId: null,
      allGearsComplete: true
    })
    expect(result.submissionEligible).toBe(true)
  })

  test('derives Amended display status and resubmission eligibility for an amended draft', async () => {
    const db = buildFakeDb([toDocument(amendedDraftExample)])

    const result = await retrieveCatchRecord({
      db,
      authenticationContext: { userId: OWNER_USER_ID, scopes: [] },
      catchRecordId: amendedDraftExample.id
    })

    expect(result.displayStatus).toBe('Amended')
    expect(result.submissionEligible).toBe(true)
  })

  test('derives Submitted and ineligible submission for a submitted record', async () => {
    const db = buildFakeDb([toDocument(submittedExample)])

    const result = await retrieveCatchRecord({
      db,
      authenticationContext: { userId: OWNER_USER_ID, scopes: [] },
      catchRecordId: submittedExample.id
    })

    expect(result.displayStatus).toBe('Submitted')
    expect(result.submissionEligible).toBe(false)
  })

  test('derives Complete and ineligible submission for a completed record', async () => {
    const db = buildFakeDb([toDocument(completeExample)])

    const result = await retrieveCatchRecord({
      db,
      authenticationContext: { userId: OWNER_USER_ID, scopes: [] },
      catchRecordId: completeExample.id
    })

    expect(result.displayStatus).toBe('Complete')
    expect(result.submissionEligible).toBe(false)
  })

  test('submissionEligible is false when the lifecycle permits submission but a section is incomplete', async () => {
    const incompleteDraft = { ...newDraftExample, gears: [] }
    const db = buildFakeDb([toDocument(incompleteDraft)])

    const result = await retrieveCatchRecord({
      db,
      authenticationContext: { userId: OWNER_USER_ID, scopes: [] },
      catchRecordId: incompleteDraft.id
    })

    expect(result.sectionCompletion.gears).toBe(false)
    expect(result.incompleteSections).toEqual(['gears'])
    expect(result.submissionEligible).toBe(false)
  })

  test('reports currentIncompleteGearAssociationId only when exactly one gear is incomplete', async () => {
    const incompleteGear = { ...newDraftExample.gears[0], characteristics: [] }
    const draftWithOneIncompleteGear = {
      ...newDraftExample,
      gears: [incompleteGear]
    }
    const db = buildFakeDb([toDocument(draftWithOneIncompleteGear)])

    const result = await retrieveCatchRecord({
      db,
      authenticationContext: { userId: OWNER_USER_ID, scopes: [] },
      catchRecordId: draftWithOneIncompleteGear.id
    })

    expect(result.progress.incompleteGearAssociationIds).toEqual([
      incompleteGear.associationId
    ])
    expect(result.progress.currentIncompleteGearAssociationId).toBe(
      incompleteGear.associationId
    )
    expect(result.progress.allGearsComplete).toBe(false)
  })

  test('preserves historical reference snapshots exactly as stored', async () => {
    const db = buildFakeDb([toDocument(newDraftExample)])

    const result = await retrieveCatchRecord({
      db,
      authenticationContext: { userId: OWNER_USER_ID, scopes: [] },
      catchRecordId: newDraftExample.id
    })

    expect(result.vessel.nameSnapshot).toBe(newDraftExample.vessel.nameSnapshot)
    expect(result.gears[0].gear.nameSnapshot).toBe(
      newDraftExample.gears[0].gear.nameSnapshot
    )
  })

  test('throws CATCH_RECORD_NOT_FOUND for a missing record', async () => {
    const db = buildFakeDb([])

    await expect(
      retrieveCatchRecord({
        db,
        authenticationContext: { userId: OWNER_USER_ID, scopes: [] },
        catchRecordId: 'does-not-exist'
      })
    ).rejects.toMatchObject({
      category: 'RESOURCE_NOT_FOUND',
      code: 'CATCH_RECORD_NOT_FOUND'
    })
  })

  test("throws the identical CATCH_RECORD_NOT_FOUND for another owner's record (no existence disclosure)", async () => {
    const db = buildFakeDb([toDocument(newDraftExample)])

    await expect(
      retrieveCatchRecord({
        db,
        authenticationContext: { userId: 'someone-else', scopes: [] },
        catchRecordId: newDraftExample.id
      })
    ).rejects.toMatchObject({
      category: 'RESOURCE_NOT_FOUND',
      code: 'CATCH_RECORD_NOT_FOUND'
    })
  })

  test('performs no persistence write (read-only)', async () => {
    const db = buildFakeDb([toDocument(newDraftExample)])

    await retrieveCatchRecord({
      db,
      authenticationContext: { userId: OWNER_USER_ID, scopes: [] },
      catchRecordId: newDraftExample.id
    })

    expect(db._collection.findOne).toHaveBeenCalledTimes(1)
  })

  test('never includes frontend navigation fields', async () => {
    const db = buildFakeDb([toDocument(newDraftExample)])

    const result = await retrieveCatchRecord({
      db,
      authenticationContext: { userId: OWNER_USER_ID, scopes: [] },
      catchRecordId: newDraftExample.id
    })

    expect(result).not.toHaveProperty('currentStep')
    expect(result).not.toHaveProperty('nextStep')
    expect(result).not.toHaveProperty('route')
    expect(result).not.toHaveProperty('screen')
  })

  test('the response is frozen (immutability)', async () => {
    const db = buildFakeDb([toDocument(newDraftExample)])

    const result = await retrieveCatchRecord({
      db,
      authenticationContext: { userId: OWNER_USER_ID, scopes: [] },
      catchRecordId: newDraftExample.id
    })

    expect(Object.isFrozen(result)).toBe(true)
  })
})
