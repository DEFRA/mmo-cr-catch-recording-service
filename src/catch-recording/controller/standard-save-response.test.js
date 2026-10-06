import { buildStandardSaveResponse } from './standard-save-response.js'
import {
  newDraftExample,
  amendedDraftExample,
  submittedExample,
  completeExample
} from '#/catch-recording/domain/__fixtures__/canonical-catch-record.fixtures.js'

describe('#buildStandardSaveResponse', () => {
  test('maps the approved public-safe fields for a brand-new draft', () => {
    const response = buildStandardSaveResponse(newDraftExample)

    expect(response).toEqual({
      id: newDraftExample.id,
      catchRecordReference: newDraftExample.catchRecordReference,
      status: 'DRAFT',
      displayStatus: 'Draft',
      version: newDraftExample.version,
      savedSection: null,
      sectionCompletion: { trip: true, pairFishing: true, gears: true },
      progress: {
        hasUnsubmittedChanges: false,
        numberOfSubmissions: 0,
        incompleteGearAssociationIds: [],
        currentIncompleteGearAssociationId: null,
        allGearsComplete: true
      }
    })
  })

  test('derives Amended for a DRAFT with a prior submission', () => {
    const response = buildStandardSaveResponse(amendedDraftExample)

    expect(response.status).toBe('DRAFT')
    expect(response.displayStatus).toBe('Amended')
    expect(response.progress).toEqual({
      hasUnsubmittedChanges: true,
      numberOfSubmissions: 1,
      incompleteGearAssociationIds: [],
      currentIncompleteGearAssociationId: null,
      allGearsComplete: true
    })
  })

  test('derives Submitted and Complete for their respective statuses', () => {
    expect(buildStandardSaveResponse(submittedExample).displayStatus).toBe(
      'Submitted'
    )
    expect(buildStandardSaveResponse(completeExample).displayStatus).toBe(
      'Complete'
    )
  })

  test('identifies the saved section when supplied', () => {
    const response = buildStandardSaveResponse(newDraftExample, 'trip')
    expect(response.savedSection).toBe('trip')
  })

  test('reports trip incomplete when a port is missing', () => {
    const incompleteTrip = {
      ...newDraftExample,
      trip: { ...newDraftExample.trip, returnPort: undefined }
    }

    expect(
      buildStandardSaveResponse(incompleteTrip).sectionCompletion.trip
    ).toBe(false)
  })

  test('reports pair-fishing incomplete when enabled but details are missing', () => {
    const incomplete = {
      ...newDraftExample,
      pairFishing: { enabled: true, pairVessel: null, pairSkipperName: null }
    }

    expect(
      buildStandardSaveResponse(incomplete).sectionCompletion.pairFishing
    ).toBe(false)
  })

  test('reports pair-fishing complete when enabled with both details present', () => {
    const complete = {
      ...newDraftExample,
      pairFishing: {
        enabled: true,
        pairVessel: 'Other Vessel',
        pairSkipperName: 'Jane Doe'
      }
    }

    expect(
      buildStandardSaveResponse(complete).sectionCompletion.pairFishing
    ).toBe(true)
  })

  test('Step 26: reports sectionCompletion.gears and progress facts false when a gear is incomplete', () => {
    const incomplete = {
      ...newDraftExample,
      gears: [{ ...newDraftExample.gears[0], statisticalArea: null }]
    }

    const response = buildStandardSaveResponse(incomplete)

    expect(response.sectionCompletion.gears).toBe(false)
    expect(response.progress.allGearsComplete).toBe(false)
    expect(response.progress.incompleteGearAssociationIds).toEqual([
      newDraftExample.gears[0].associationId
    ])
    expect(response.progress.currentIncompleteGearAssociationId).toBe(
      newDraftExample.gears[0].associationId
    )
  })

  test('Step 26: reports incomplete when the gears collection is empty', () => {
    const noGears = { ...newDraftExample, gears: [] }

    const response = buildStandardSaveResponse(noGears)

    expect(response.sectionCompletion.gears).toBe(false)
    expect(response.progress.allGearsComplete).toBe(false)
    expect(response.progress.incompleteGearAssociationIds).toEqual([])
    expect(response.progress.currentIncompleteGearAssociationId).toBeNull()
  })

  test('never exposes internal persistence or history metadata', () => {
    const response = buildStandardSaveResponse(newDraftExample)
    const serialised = JSON.stringify(response)

    expect(serialised).not.toContain('createdAt')
    expect(serialised).not.toContain('ownerUserId')
    expect(serialised).not.toContain('schemaVersion')
  })

  test('returns a frozen response', () => {
    expect(Object.isFrozen(buildStandardSaveResponse(newDraftExample))).toBe(
      true
    )
  })
})
