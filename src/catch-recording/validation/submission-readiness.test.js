import { validateSubmissionReadiness } from './submission-readiness.js'
import {
  amendedDraftExample,
  completeExample,
  newDraftExample,
  submittedExample
} from '../domain/__fixtures__/canonical-catch-record.fixtures.js'
import { ApplicationError } from '#/common/helpers/errors/application-error.js'

const SHARED_USER_ID = 'e0ec9737-908e-4749-97e0-41caf19de2c2'
const VESSEL_ID = '0fe4d4aa-22f8-449e-89c9-b7052bae8667'

/** A generic, fixture-agnostic Reference Data Service client stub: every resource echoes its requested
 * id back as an active, resolvable reference, so it works unchanged against every canonical fixture. */
function buildReferenceDataClient(overrides = {}) {
  return {
    listAccessibleVesselIds: vi.fn().mockResolvedValue([VESSEL_ID]),
    getVesselById: vi.fn(async (id) => ({
      id,
      status: 'active',
      name: 'EXAMPLE VESSEL',
      identifiers: { registrationNumber: 'RSS123456', externalMark: 'PH123' },
      lengthOverallMetres: 8.74
    })),
    getPortById: vi.fn(async (id) => ({
      id,
      code: '0349',
      name: 'Plymouth',
      active: true
    })),
    getGearById: vi.fn(async (id) => ({
      id,
      code: 'TBB',
      name: 'Beam Trawl',
      active: true,
      characteristics: []
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
      commonNames: [{ name: 'Atlantic Cod' }],
      active: true
    })),
    ...overrides
  }
}

const authenticationContext = Object.freeze({ userId: SHARED_USER_ID })

describe('#validateSubmissionReadiness', () => {
  test.each(Object.entries({ newDraftExample, amendedDraftExample }))(
    'Should accept the eligible %s fixture once every reference resolves',
    async (_name, fixture) => {
      const referenceDataClient = buildReferenceDataClient()

      const result = await validateSubmissionReadiness(fixture, {
        referenceDataClient,
        authenticationContext
      })

      expect(result).toEqual({ valid: true, issues: [] })
    }
  )

  test.each(Object.entries({ submittedExample, completeExample }))(
    'Should reject the lifecycle-ineligible %s fixture with INELIGIBLE_TRANSITION',
    async (_name, fixture) => {
      const referenceDataClient = buildReferenceDataClient()

      const result = await validateSubmissionReadiness(fixture, {
        referenceDataClient,
        authenticationContext
      })

      expect(result.valid).toBe(false)
      expect(result.issues).toContainEqual({
        code: 'INELIGIBLE_TRANSITION',
        path: 'status',
        message:
          'Only a never-submitted draft or an amended draft is eligible for submission'
      })
    }
  )

  test('Should return only the structural failure for a malformed root without calling the Reference Data Service', async () => {
    const referenceDataClient = buildReferenceDataClient()

    const result = await validateSubmissionReadiness('not-an-object', {
      referenceDataClient,
      authenticationContext
    })

    expect(result).toEqual({
      valid: false,
      issues: [
        { code: 'INVALID_STRUCTURE', path: '', message: 'Invalid structure' }
      ]
    })
    expect(referenceDataClient.getVesselById).not.toHaveBeenCalled()
  })

  test('Should reject a vessel selection no longer active', async () => {
    const referenceDataClient = buildReferenceDataClient({
      getVesselById: vi.fn().mockResolvedValue({
        id: VESSEL_ID,
        status: 'inactive',
        name: 'EXAMPLE VESSEL',
        identifiers: { registrationNumber: 'RSS123456', externalMark: 'PH123' },
        lengthOverallMetres: 8.74
      })
    })

    const result = await validateSubmissionReadiness(newDraftExample, {
      referenceDataClient,
      authenticationContext
    })

    expect(result.valid).toBe(false)
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: 'INVALID_REFERENCE', path: 'vessel.id' })
    )
  })

  test('Should reject a species no longer resolvable (RESOURCE_NOT_FOUND translated to INVALID_REFERENCE)', async () => {
    const referenceDataClient = buildReferenceDataClient({
      getSpeciesById: vi.fn().mockRejectedValue(
        new ApplicationError({
          category: 'RESOURCE_NOT_FOUND',
          message: 'gone'
        })
      )
    })

    const result = await validateSubmissionReadiness(newDraftExample, {
      referenceDataClient,
      authenticationContext
    })

    expect(result.valid).toBe(false)
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: 'INVALID_REFERENCE' })
    )
  })

  test('Should propagate a Reference Data Service dependency failure rather than reporting it as a business-validation issue', async () => {
    const referenceDataClient = buildReferenceDataClient({
      getPortById: vi.fn().mockRejectedValue(
        new ApplicationError({
          category: 'UPSTREAM_TIMEOUT',
          message: 'timeout'
        })
      )
    })

    await expect(
      validateSubmissionReadiness(newDraftExample, {
        referenceDataClient,
        authenticationContext
      })
    ).rejects.toMatchObject({ category: 'UPSTREAM_TIMEOUT' })
  })

  test('Should propagate vessel-access denial as an AUTHORISATION_FAILURE rather than a validation issue', async () => {
    const referenceDataClient = buildReferenceDataClient({
      listAccessibleVesselIds: vi.fn().mockResolvedValue([])
    })

    await expect(
      validateSubmissionReadiness(newDraftExample, {
        referenceDataClient,
        authenticationContext
      })
    ).rejects.toMatchObject({ category: 'AUTHORISATION_FAILURE' })
  })

  test('Should deduplicate repeated reference lookups for the same stable id within one execution', async () => {
    const referenceDataClient = buildReferenceDataClient()
    const duplicateSpeciesRecord = {
      ...newDraftExample,
      gears: [
        newDraftExample.gears[0],
        {
          ...newDraftExample.gears[0],
          associationId: 'second-gear-association'
        }
      ]
    }

    await validateSubmissionReadiness(duplicateSpeciesRecord, {
      referenceDataClient,
      authenticationContext
    })

    // Both gear occurrences share the same gear id, statistical-area id, and species id - each must be
    // resolved exactly once.
    expect(referenceDataClient.getGearById).toHaveBeenCalledTimes(1)
    expect(referenceDataClient.getStatisticalAreaById).toHaveBeenCalledTimes(1)
    expect(referenceDataClient.getSpeciesById).toHaveBeenCalledTimes(1)
  })

  test('Should return the sync-only result for a plain object that is not yet safe to walk', async () => {
    const referenceDataClient = buildReferenceDataClient()

    const result = await validateSubmissionReadiness(
      { ...newDraftExample, gears: 'not-an-array' },
      { referenceDataClient, authenticationContext }
    )

    expect(result.valid).toBe(false)
    expect(referenceDataClient.getVesselById).not.toHaveBeenCalled()
  })

  test('Should skip a reference lookup for an absent statistical area or species-not-landed id, while still reporting the gear as incomplete', async () => {
    const referenceDataClient = buildReferenceDataClient()
    const fixtureWithGaps = {
      ...newDraftExample,
      gears: [
        {
          ...newDraftExample.gears[0],
          statisticalArea: undefined,
          speciesCaught: []
        }
      ],
      speciesNotLanded: [{ nameSnapshot: 'Unknown' }]
    }

    const result = await validateSubmissionReadiness(fixtureWithGaps, {
      referenceDataClient,
      authenticationContext
    })

    expect(result.valid).toBe(false)
    expect(result.issues).toContainEqual({
      code: 'REQUIRED',
      path: 'gears.0',
      message: 'This gear is not complete and cannot be submitted'
    })
    expect(referenceDataClient.getStatisticalAreaById).not.toHaveBeenCalled()
    expect(referenceDataClient.getSpeciesById).not.toHaveBeenCalled()
  })

  test('Should reject a record with no gears at all', async () => {
    const referenceDataClient = buildReferenceDataClient()

    const result = await validateSubmissionReadiness(
      { ...newDraftExample, gears: [] },
      { referenceDataClient, authenticationContext }
    )

    expect(result.valid).toBe(false)
    expect(result.issues).toContainEqual({
      code: 'REQUIRED',
      path: 'gears',
      message: 'At least one complete gear is required before submission'
    })
  })

  test('Should skip reference lookups entirely for vessel, port, and gear selections with no stable id', async () => {
    const referenceDataClient = buildReferenceDataClient()
    const fixtureWithMissingIds = {
      ...newDraftExample,
      vessel: { nameSnapshot: 'EXAMPLE VESSEL' },
      trip: {
        ...newDraftExample.trip,
        departurePort: { nameSnapshot: 'Plymouth' },
        returnPort: { nameSnapshot: 'Plymouth' }
      },
      gears: [{ ...newDraftExample.gears[0], gear: { codeSnapshot: 'TBB' } }]
    }

    const result = await validateSubmissionReadiness(fixtureWithMissingIds, {
      referenceDataClient,
      authenticationContext
    })

    expect(result.valid).toBe(false)
    expect(referenceDataClient.getVesselById).not.toHaveBeenCalled()
    expect(referenceDataClient.getPortById).not.toHaveBeenCalled()
    expect(referenceDataClient.getGearById).not.toHaveBeenCalled()
  })

  test('Should not mutate its input', async () => {
    const referenceDataClient = buildReferenceDataClient()
    const inputCopy = JSON.parse(JSON.stringify(newDraftExample))

    await validateSubmissionReadiness(newDraftExample, {
      referenceDataClient,
      authenticationContext
    })

    expect(newDraftExample).toEqual(inputCopy)
  })
})
