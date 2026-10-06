/* global fetchMock */
import { createReferenceDataClient } from './reference-data-client.js'

const OPTIONS = {
  baseUrl: 'https://reference-data-service.example',
  serviceToken: 'service-token',
  timeoutMs: 1000
}

describe('#createReferenceDataClient', () => {
  test('Should expose exactly the five approved operations and nothing else', () => {
    const client = createReferenceDataClient(OPTIONS)

    expect(Object.keys(client).sort()).toEqual([
      'getGearById',
      'getPortById',
      'getSpeciesById',
      'getStatisticalAreaById',
      'getVesselById'
    ])
  })

  test('Should be frozen - no caller can add a generic method later', () => {
    const client = createReferenceDataClient(OPTIONS)

    expect(Object.isFrozen(client)).toBe(true)
  })

  test('Should resolve a vessel end to end through the composed client', async () => {
    fetchMock.mockResponseOnce(
      JSON.stringify({
        id: 'vessel-1',
        name: 'Example Vessel',
        namePln: null,
        identifiers: {
          cfr: null,
          uvi: null,
          mmsi: null,
          ircs: null,
          externalMark: null,
          registrationNumber: null
        },
        lengthOverallMetres: 10,
        status: 'active',
        activeFrom: '2020-01-01',
        activeTo: null
      })
    )
    const client = createReferenceDataClient(OPTIONS)

    const vessel = await client.getVesselById('vessel-1')

    expect(vessel.id).toBe('vessel-1')
  })
})
