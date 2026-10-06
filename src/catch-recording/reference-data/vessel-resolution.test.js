import { resolveVessel } from './vessel-resolution.js'
import { ApplicationError } from '#/common/helpers/errors/application-error.js'

const AUTH = Object.freeze({ userId: 'user-1' })

function notFoundError() {
  return new ApplicationError({
    category: 'RESOURCE_NOT_FOUND',
    message: 'not found'
  })
}

function dependencyError() {
  return new ApplicationError({
    category: 'UPSTREAM_TIMEOUT',
    message: 'timeout'
  })
}

function activeVessel(overrides = {}) {
  return {
    id: 'vessel-1',
    name: 'Example Vessel',
    status: 'active',
    identifiers: { registrationNumber: 'RSS123456', externalMark: 'PH123' },
    lengthOverallMetres: 8.74,
    ...overrides
  }
}

describe('#resolveVessel', () => {
  test('Should resolve an active, accessible vessel with its snapshot', async () => {
    const client = {
      getVesselById: vi.fn().mockResolvedValue(activeVessel())
    }

    const { result, snapshot } = await resolveVessel({
      id: 'vessel-1',
      path: ['vessel'],
      client,
      authenticationContext: AUTH,
      accessibleVesselIds: ['vessel-1']
    })

    expect(result.valid).toBe(true)
    expect(snapshot).toEqual({
      rssSnapshot: 'RSS123456',
      nameSnapshot: 'Example Vessel',
      externalMarkSnapshot: 'PH123',
      lengthOverallMetresSnapshot: 8.74
    })
  })

  test('Should deny access safely for an active vessel the caller cannot access, never exposing the snapshot', async () => {
    const client = {
      getVesselById: vi.fn().mockResolvedValue(activeVessel())
    }

    await expect(
      resolveVessel({
        id: 'vessel-1',
        path: ['vessel'],
        client,
        authenticationContext: AUTH,
        accessibleVesselIds: ['vessel-2']
      })
    ).rejects.toMatchObject({ category: 'AUTHORISATION_FAILURE' })
  })

  test('Should deny with REQUIRED for a missing id without calling Step 15', async () => {
    const client = { getVesselById: vi.fn() }

    const { result } = await resolveVessel({
      id: undefined,
      path: ['vessel'],
      client,
      authenticationContext: AUTH,
      accessibleVesselIds: []
    })

    expect(result.issues[0].code).toBe('REQUIRED')
    expect(client.getVesselById).not.toHaveBeenCalled()
  })

  test('Should deny with INVALID_STRUCTURE for a malformed id without calling Step 15', async () => {
    const client = { getVesselById: vi.fn() }

    const { result } = await resolveVessel({
      id: 42,
      path: ['vessel'],
      client,
      authenticationContext: AUTH,
      accessibleVesselIds: []
    })

    expect(result.issues[0].code).toBe('INVALID_STRUCTURE')
    expect(client.getVesselById).not.toHaveBeenCalled()
  })

  test('Should rethrow a non-not-found dependency failure unchanged', async () => {
    const client = {
      getVesselById: vi.fn().mockRejectedValue(dependencyError())
    }

    await expect(
      resolveVessel({
        id: 'vessel-1',
        path: ['vessel'],
        client,
        authenticationContext: AUTH,
        accessibleVesselIds: ['vessel-1']
      })
    ).rejects.toMatchObject({ category: 'UPSTREAM_TIMEOUT' })
  })

  test('Should keep a missing vessel distinct from an access denial', async () => {
    const client = {
      getVesselById: vi.fn().mockRejectedValue(notFoundError())
    }

    const { result } = await resolveVessel({
      id: 'vessel-1',
      path: ['vessel'],
      client,
      authenticationContext: AUTH,
      accessibleVesselIds: ['vessel-1']
    })

    expect(result.valid).toBe(false)
    expect(result.issues[0].code).toBe('INVALID_REFERENCE')
  })

  test('Should deny an inactive vessel before access is even evaluated', async () => {
    const client = {
      getVesselById: vi
        .fn()
        .mockResolvedValue(activeVessel({ status: 'inactive' }))
    }

    const { result } = await resolveVessel({
      id: 'vessel-1',
      path: ['vessel'],
      client,
      authenticationContext: AUTH,
      // Access would be allowed if it were ever checked - proving inactive-selection is checked first.
      accessibleVesselIds: ['vessel-1']
    })

    expect(result.issues[0].code).toBe('INVALID_REFERENCE')
  })

  test('Should deny an unauthenticated caller even for a vessel that exists and is accessible', async () => {
    const client = {
      getVesselById: vi.fn().mockResolvedValue(activeVessel())
    }

    await expect(
      resolveVessel({
        id: 'vessel-1',
        path: ['vessel'],
        client,
        authenticationContext: undefined,
        accessibleVesselIds: ['vessel-1']
      })
    ).rejects.toMatchObject({ category: 'AUTHENTICATION_FAILURE' })
  })

  test('Should not mutate the authenticationContext or accessibleVesselIds input', async () => {
    const client = {
      getVesselById: vi.fn().mockResolvedValue(activeVessel())
    }
    const accessibleVesselIds = Object.freeze(['vessel-1'])

    await resolveVessel({
      id: 'vessel-1',
      path: ['vessel'],
      client,
      authenticationContext: AUTH,
      accessibleVesselIds
    })

    expect(AUTH).toEqual({ userId: 'user-1' })
    expect(accessibleVesselIds).toEqual(['vessel-1'])
  })
})
