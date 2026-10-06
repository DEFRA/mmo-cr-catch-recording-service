import { createGetGearById } from './gears-client.js'

function characteristicCatalog(overrides = []) {
  return [
    {
      id: 'char-1',
      code: 'MESH',
      name: 'Mesh Size',
      dataType: 'number',
      unit: 'mm',
      minValue: 1,
      maxValue: 200
    },
    ...overrides
  ]
}

function gearItem(overrides = {}) {
  return {
    id: 'gear-1',
    code: 'TBB',
    name: 'Beam Trawl',
    type: 'towed',
    categoryId: 'category-1',
    pairFishing: false,
    active: true,
    applicableCharacteristics: [
      {
        id: 'applicable-1',
        characteristicId: 'char-1',
        fixed: true,
        required: true
      }
    ],
    ...overrides
  }
}

function envelope({
  items = [gearItem()],
  characteristics = characteristicCatalog()
} = {}) {
  return { items, characteristics, categories: [] }
}

function fakeHttpClient(response) {
  return { get: vi.fn().mockResolvedValue(response) }
}

describe('#createGetGearById', () => {
  test('Should request the gear collection endpoint with an ids filter and includeInactive=true', async () => {
    const httpClient = fakeHttpClient({ status: 200, body: envelope() })
    const getGearById = createGetGearById({ httpClient })

    await getGearById('gear-1', { correlationId: 'trace-1' })

    expect(httpClient.get).toHaveBeenCalledWith({
      path: '/api/v1/reference-data/gears?ids=gear-1&includeInactive=true',
      correlationId: 'trace-1'
    })
  })

  test('Should return the gear with characteristics resolved from the catalog', async () => {
    const httpClient = fakeHttpClient({ status: 200, body: envelope() })
    const getGearById = createGetGearById({ httpClient })

    const gear = await getGearById('gear-1')

    expect(gear.code).toBe('TBB')
    expect(gear.characteristics).toEqual([
      {
        characteristicId: 'char-1',
        fixed: true,
        required: true,
        vesselLengthApplicability: [],
        name: 'Mesh Size',
        unit: 'mm',
        dataType: 'number',
        minValue: 1,
        maxValue: 200
      }
    ])
    expect(Object.isFrozen(gear)).toBe(true)
    expect(Object.isFrozen(gear.characteristics)).toBe(true)
  })

  test('Should default optional catalog fields (unit/minValue/maxValue) to null when absent', async () => {
    const httpClient = fakeHttpClient({
      status: 200,
      body: envelope({
        characteristics: [
          { id: 'char-1', code: 'MESH', name: 'Mesh Size', dataType: 'number' }
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

  test('Should not expose category data (categories[] is never consumed)', async () => {
    const httpClient = fakeHttpClient({ status: 200, body: envelope() })
    const getGearById = createGetGearById({ httpClient })

    const gear = await getGearById('gear-1')

    expect(gear).not.toHaveProperty('categories')
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

  test('Should raise UPSTREAM_INVALID_RESPONSE when a characteristicId is not in the catalog', async () => {
    const httpClient = fakeHttpClient({
      status: 200,
      body: envelope({ characteristics: [] })
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
    ['non-array characteristics', envelope({ characteristics: 'x' })],
    [
      'invalid gear item',
      envelope({ items: [gearItem({ pairFishing: 'no' })] })
    ],
    ['non-object gear item', envelope({ items: ['not-an-object'] })],
    [
      'invalid applicableCharacteristics entry',
      envelope({
        items: [
          gearItem({
            applicableCharacteristics: [{ id: 'x', characteristicId: 'char-1' }]
          })
        ]
      })
    ],
    [
      'non-object applicableCharacteristics entry',
      envelope({
        items: [gearItem({ applicableCharacteristics: ['not-an-object'] })]
      })
    ],
    [
      'invalid catalog entry',
      envelope({ characteristics: [{ id: 'char-1' }] })
    ],
    [
      'non-object catalog entry',
      envelope({ characteristics: ['not-an-object'] })
    ]
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

  test('Should preserve a supplied vesselLengthApplicability array without sharing the input reference', async () => {
    const vesselLengthApplicability = ['under-10m']
    const httpClient = fakeHttpClient({
      status: 200,
      body: envelope({
        items: [
          gearItem({
            applicableCharacteristics: [
              {
                id: 'applicable-1',
                characteristicId: 'char-1',
                fixed: true,
                required: true,
                vesselLengthApplicability
              }
            ]
          })
        ]
      })
    })
    const getGearById = createGetGearById({ httpClient })

    const gear = await getGearById('gear-1')

    expect(gear.characteristics[0].vesselLengthApplicability).toEqual([
      'under-10m'
    ])
    expect(gear.characteristics[0].vesselLengthApplicability).not.toBe(
      vesselLengthApplicability
    )
  })
})
