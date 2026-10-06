import { resolveVessel } from './vessel-resolution.js'
import { createAuthenticationContext } from '#/catch-recording/controller/authentication-context.js'

/**
 * Proves real composition across Steps 13, 14, and 15: a real Step 13 authentication context, the real
 * Step 14 vessel-access policy (imported transitively by vessel-resolution.js), and a fake Step 15
 * client resolve correctly end-to-end - no Hapi, no network, no mocking of the modules under test.
 */
describe('#vessel-resolution composition (Steps 13 -> 14 -> 15 -> snapshot)', () => {
  test('Should compose a real authentication context with real Step 14 policy and resolve a snapshot', async () => {
    const authenticationContext = createAuthenticationContext({
      actorId: 'user-1',
      permissions: ['catch-recording.read']
    })
    const client = {
      getVesselById: vi.fn().mockResolvedValue({
        id: 'vessel-1',
        name: 'Example Vessel',
        status: 'active',
        identifiers: { registrationNumber: 'RSS1', externalMark: 'PH1' },
        lengthOverallMetres: 9
      })
    }

    const { result, snapshot } = await resolveVessel({
      id: 'vessel-1',
      path: ['vessel'],
      client,
      authenticationContext,
      accessibleVesselIds: ['vessel-1']
    })

    expect(result.valid).toBe(true)
    expect(snapshot.nameSnapshot).toBe('Example Vessel')
  })

  test('Should compose a real authentication context and deny via the real Step 14 policy for an inaccessible vessel', async () => {
    const authenticationContext = createAuthenticationContext({
      actorId: 'user-1',
      permissions: []
    })
    const client = {
      getVesselById: vi.fn().mockResolvedValue({
        id: 'vessel-1',
        name: 'Example Vessel',
        status: 'active',
        identifiers: { registrationNumber: null, externalMark: null },
        lengthOverallMetres: 9
      })
    }

    await expect(
      resolveVessel({
        id: 'vessel-1',
        path: ['vessel'],
        client,
        authenticationContext,
        accessibleVesselIds: []
      })
    ).rejects.toMatchObject({ category: 'AUTHORISATION_FAILURE' })
  })
})
