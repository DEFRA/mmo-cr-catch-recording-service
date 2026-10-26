import { createGetGearById } from './gears-client.js'

function measurementCatalog(overrides = []) {
  return [
    {
      id: 'char-1',
      code: 'ME',
      label: 'Mesh size',
      kind: 'number',
      unit: 'mm',
      minimumValue: 1,
      maximumValue: 200
    },
    ...overrides
  ]
}

function gearItem(overrides = {}) {
  return {
    id: 'gear-1',
    code: 'TBB',
    name: 'Beam Trawl',
    category: { id: 'category-1', code: 'TRAWL', name: 'Trawl nets' },
    pairFishing: false,
    requiredMeasurementIds: ['char-1'],
    variableMeasurementIds: [],
    ...overrides
  }
}

function envelope({
  items = [gearItem()],
  measurements = measurementCatalog()
} = {}) {
  return { items, measurements }
}

function fakeHttpClient(response) {
  return { get: vi.fn().mockResolvedValue(response) }
}

describe('#createGetGearById', () => {
  test('Should request the gear collection endpoint with ids, includeInactive=true and view=mobile', async () => {
    const httpClient = fakeHttpClient({ status: 200, body: envelope() })
    const getGearById = createGetGearById({ httpClient })

    await getGearById('gear-1', { correlationId: 'trace-1' })

    expect(httpClient.get).toHaveBeenCalledWith({
      path: '/api/v1/reference-data/gears?ids=gear-1&includeInactive=true&view=mobile',
      correlationId: 'trace-1'
    })
  })

  test('Should return the gear with characteristics resolved from the measurements catalog', async () => {
    const httpClient = fakeHttpClient({ status: 200, body: envelope() })
    const getGearById = createGetGearById({ httpClient })

    const gear = await getGearById('gear-1')

    expect(gear.code).toBe('TBB')
    expect(gear.pairFishing).toBe(false)
    expect(gear.characteristics).toEqual([
      {
        characteristicId: 'char-1',
        required: true,
        name: 'Mesh size',
        unit: 'mm',
        dataType: 'number',
        minValue: 1,
        maxValue: 200
      }
    ])
    expect(Object.isFrozen(gear)).toBe(true)
    expect(Object.isFrozen(gear.characteristics)).toBe(true)
  })

  test('Should mark a variable (non-required) measurement as required: false', async () => {
    const httpClient = fakeHttpClient({
      status: 200,
      body: envelope({
        items: [
          gearItem({
            requiredMeasurementIds: [],
            variableMeasurementIds: ['char-1']
          })
        ]
      })
    })
    const getGearById = createGetGearById({ httpClient })

    const gear = await getGearById('gear-1')

    expect(gear.characteristics[0].required).toBe(false)
  })

  test('Should default optional catalog fields (unit/minValue/maxValue) to null when absent', async () => {
    const httpClient = fakeHttpClient({
      status: 200,
      body: envelope({
        measurements: [
          { id: 'char-1', code: 'ME', label: 'Mesh size', kind: 'number' }
        ]
      })
    })
    const getGearById = createGetGearById({ httpClient })

    const gear = await getGearById('gear-1')

    expect(gear.characteristics[0]).toMatchObject({
      unit: null,
      minValue: null,
      maxValue: null
    })
  })

  test('Should not expose category data (category is never consumed)', async () => {
    const httpClient = fakeHttpClient({ status: 200, body: envelope() })
    const getGearById = createGetGearById({ httpClient })

    const gear = await getGearById('gear-1')

    expect(gear).not.toHaveProperty('category')
    expect(gear).not.toHaveProperty('active')
  })

  test('Should reject an invalid id without a network call', async () => {
    const httpClient = fakeHttpClient({})
    const getGearById = createGetGearById({ httpClient })

    await expect(getGearById('../x')).rejects.toThrow()
    expect(httpClient.get).not.toHaveBeenCalled()
  })

  test('Should raise RESOURCE_NOT_FOUND when the ids-filtered collection returns no items', async () => {
    const httpClient = fakeHttpClient({
      status: 200,
      body: envelope({ items: [] })
    })
    const getGearById = createGetGearById({ httpClient })

    try {
      await getGearById('gear-1')
      throw new Error('expected getGearById to reject')
    } catch (error) {
      expect(error.category).toBe('RESOURCE_NOT_FOUND')
    }
  })

  test('Should raise UPSTREAM_INVALID_RESPONSE when more than one item is returned for a single id', async () => {
    const httpClient = fakeHttpClient({
      status: 200,
      body: envelope({ items: [gearItem(), gearItem({ id: 'gear-2' })] })
    })
    const getGearById = createGetGearById({ httpClient })

    try {
      await getGearById('gear-1')
      throw new Error('expected getGearById to reject')
    } catch (error) {
      expect(error.category).toBe('UPSTREAM_INVALID_RESPONSE')
    }
  })

  test('Should raise UPSTREAM_INVALID_RESPONSE when a measurement id is not in the catalog', async () => {
    const httpClient = fakeHttpClient({
      status: 200,
      body: envelope({ measurements: [] })
    })
    const getGearById = createGetGearById({ httpClient })

    try {
      await getGearById('gear-1')
      throw new Error('expected getGearById to reject')
    } catch (error) {
      expect(error.category).toBe('UPSTREAM_INVALID_RESPONSE')
    }
  })

  test('Should raise UPSTREAM_INVALID_RESPONSE when a measurement id appears in both required and variable lists', async () => {
    const httpClient = fakeHttpClient({
      status: 200,
      body: envelope({
        items: [
          gearItem({
            requiredMeasurementIds: ['char-1'],
            variableMeasurementIds: ['char-1']
          })
        ]
      })
    })
    const getGearById = createGetGearById({ httpClient })

    try {
      await getGearById('gear-1')
      throw new Error('expected getGearById to reject')
    } catch (error) {
      expect(error.category).toBe('UPSTREAM_INVALID_RESPONSE')
    }
  })

  test('Should raise UPSTREAM_INVALID_RESPONSE for an unexpected status', async () => {
    const httpClient = fakeHttpClient({ status: 500, body: null })
    const getGearById = createGetGearById({ httpClient })

    try {
      await getGearById('gear-1')
      throw new Error('expected getGearById to reject')
    } catch (error) {
      expect(error.category).toBe('UPSTREAM_INVALID_RESPONSE')
    }
  })

  test.each([
    ['missing root', null],
    ['non-array items', envelope({ items: 'x' })],
    ['non-array measurements', envelope({ measurements: 'x' })],
    [
      'invalid gear item',
      envelope({ items: [gearItem({ pairFishing: 'no' })] })
    ],
    ['non-object gear item', envelope({ items: ['not-an-object'] })],
    [
      'non-array requiredMeasurementIds',
      envelope({ items: [gearItem({ requiredMeasurementIds: 'char-1' })] })
    ],
    ['invalid catalog entry', envelope({ measurements: [{ id: 'char-1' }] })],
    ['non-object catalog entry', envelope({ measurements: ['not-an-object'] })]
  ])('Should reject a malformed envelope: %s', async (_label, body) => {
    const httpClient = fakeHttpClient({ status: 200, body })
    const getGearById = createGetGearById({ httpClient })

    try {
      await getGearById('gear-1')
      throw new Error('expected getGearById to reject')
    } catch (error) {
      expect(error.category).toBe('UPSTREAM_INVALID_RESPONSE')
    }
  })
})
