import { isApplicationError } from '#/common/helpers/errors/application-error.js'
import {
  requireVesselId,
  trustedNowIso,
  enforceVesselProfileAccess
} from './vessel-profile-access.js'

describe('#vessel-profile-access', () => {
  describe('requireVesselId', () => {
    test('accepts a non-empty string', () => {
      expect(() => requireVesselId('vessel-1')).not.toThrow()
    })

    test.each([undefined, null, '', '   ', 42])('rejects %p', (vesselId) => {
      expect(() => requireVesselId(vesselId)).toThrowError(
        expect.objectContaining({ category: 'INVALID_REQUEST' })
      )
    })
  })

  test('trustedNowIso returns an ISO timestamp', () => {
    expect(trustedNowIso()).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
    )
  })

  describe('enforceVesselProfileAccess', () => {
    test('allows a vessel present in the accessible-vessel-ids fact', async () => {
      const referenceDataClient = {
        listAccessibleVesselIds: vi.fn(async () => ['vessel-1'])
      }

      await expect(
        enforceVesselProfileAccess({
          vesselId: 'vessel-1',
          referenceDataClient,
          authenticationContext: { userId: 'owner-1' }
        })
      ).resolves.toBeUndefined()
    })

    test('denies a vessel absent from the accessible-vessel-ids fact', async () => {
      const referenceDataClient = {
        listAccessibleVesselIds: vi.fn(async () => ['vessel-2'])
      }

      await expect(
        enforceVesselProfileAccess({
          vesselId: 'vessel-1',
          referenceDataClient,
          authenticationContext: { userId: 'owner-1' }
        })
      ).rejects.toSatisfy(isApplicationError)
    })

    test('denies an unauthenticated caller', async () => {
      const referenceDataClient = {
        listAccessibleVesselIds: vi.fn(async () => ['vessel-1'])
      }

      await expect(
        enforceVesselProfileAccess({
          vesselId: 'vessel-1',
          referenceDataClient,
          authenticationContext: null
        })
      ).rejects.toSatisfy(isApplicationError)
    })
  })
})
