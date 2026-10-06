import { resolveGearsSection } from './resolve-gears-section.js'

function fakeReferenceDataClient(overrides = {}) {
  return {
    getGearById: vi.fn(async (id) => ({
      id,
      code: 'GEAR001',
      name: 'Otter trawl',
      active: true,
      characteristics: [
        { characteristicId: 'char-1', name: 'Mesh size', unit: 'mm' }
      ]
    })),
    getStatisticalAreaById: vi.fn(async (id) => ({
      id,
      code: '46F45',
      name: 'ICES 46F45'
    })),
    ...overrides
  }
}

describe('#resolveGearsSection', () => {
  test('resolves a gear and its characteristics, discarding any client-supplied snapshot', async () => {
    const client = fakeReferenceDataClient()

    const resolved = await resolveGearsSection(
      [
        {
          associationId: 'gear-assoc-1',
          gear: {
            id: 'gear-1',
            codeSnapshot: 'FORGED',
            nameSnapshot: 'Forged'
          },
          characteristics: [
            {
              characteristicId: 'char-1',
              value: 80,
              unitSnapshot: 'client-supplied',
              nameSnapshot: 'client-supplied'
            }
          ]
        }
      ],
      client,
      'correlation-1'
    )

    expect(resolved).toEqual([
      {
        associationId: 'gear-assoc-1',
        gear: {
          id: 'gear-1',
          codeSnapshot: 'GEAR001',
          nameSnapshot: 'Otter trawl'
        },
        characteristics: [
          {
            characteristicId: 'char-1',
            value: 80,
            nameSnapshot: 'Mesh size',
            unitSnapshot: 'mm'
          }
        ]
      }
    ])
    expect(client.getGearById).toHaveBeenCalledWith('gear-1', {
      correlationId: 'correlation-1'
    })
  })

  test('resolves a new gear occurrence with no client-supplied associationId, omitting it from the output', async () => {
    const client = fakeReferenceDataClient()

    const resolved = await resolveGearsSection(
      [{ gear: { id: 'gear-1' }, characteristics: [] }],
      client
    )

    expect(resolved).toHaveLength(1)
    expect(Object.hasOwn(resolved[0], 'associationId')).toBe(false)
  })

  test('preserves deterministic ordering across multiple gear associations', async () => {
    const client = fakeReferenceDataClient()

    const resolved = await resolveGearsSection(
      [
        { associationId: 'first', gear: { id: 'gear-1' }, characteristics: [] },
        { associationId: 'second', gear: { id: 'gear-1' }, characteristics: [] }
      ],
      client
    )

    expect(resolved.map((entry) => entry.associationId)).toEqual([
      'first',
      'second'
    ])
  })

  test('treats a non-array input defensively as an empty collection', async () => {
    const client = fakeReferenceDataClient()

    await expect(resolveGearsSection(undefined, client)).resolves.toEqual([])
    await expect(resolveGearsSection(null, client)).resolves.toEqual([])
    await expect(resolveGearsSection({}, client)).resolves.toEqual([])
  })

  test('aggregates a missing gear id into one BUSINESS_VALIDATION_FAILURE/SECTION_VALIDATION_FAILED error', async () => {
    const client = fakeReferenceDataClient()

    await expect(
      resolveGearsSection([{ gear: {}, characteristics: [] }], client)
    ).rejects.toMatchObject({
      category: 'BUSINESS_VALIDATION_FAILURE',
      code: 'SECTION_VALIDATION_FAILED'
    })
  })

  test('aggregates an inactive/not-found gear into BUSINESS_VALIDATION_FAILURE', async () => {
    const { ApplicationError } =
      await import('#/common/helpers/errors/application-error.js')
    const client = {
      getGearById: vi.fn(async () => {
        throw new ApplicationError({
          category: 'RESOURCE_NOT_FOUND',
          message: 'The selected gear could not be found.'
        })
      })
    }

    await expect(
      resolveGearsSection([{ gear: { id: 'missing' } }], client)
    ).rejects.toMatchObject({
      category: 'BUSINESS_VALIDATION_FAILURE',
      code: 'SECTION_VALIDATION_FAILED'
    })
  })

  test('aggregates a characteristic that does not belong to the resolved gear', async () => {
    const client = fakeReferenceDataClient()

    await expect(
      resolveGearsSection(
        [
          {
            gear: { id: 'gear-1' },
            characteristics: [{ characteristicId: 'does-not-belong', value: 1 }]
          }
        ],
        client
      )
    ).rejects.toMatchObject({
      category: 'BUSINESS_VALIDATION_FAILURE',
      code: 'SECTION_VALIDATION_FAILED'
    })
  })

  test('aggregates every issue across the whole collection into one error', async () => {
    const client = fakeReferenceDataClient()

    try {
      await resolveGearsSection(
        [
          { gear: {}, characteristics: [] },
          {
            gear: { id: 'gear-1' },
            characteristics: [{ characteristicId: 'does-not-belong', value: 1 }]
          }
        ],
        client
      )
      throw new Error('expected resolveGearsSection to reject')
    } catch (error) {
      expect(error.details.length).toBeGreaterThanOrEqual(2)
    }
  })

  test('rethrows an upstream dependency failure unchanged', async () => {
    const { ApplicationError } =
      await import('#/common/helpers/errors/application-error.js')
    const client = {
      getGearById: vi.fn(async () => {
        throw new ApplicationError({
          category: 'UPSTREAM_TIMEOUT',
          message: 'The reference data service timed out.'
        })
      })
    }

    await expect(
      resolveGearsSection([{ gear: { id: 'gear-1' } }], client)
    ).rejects.toMatchObject({ category: 'UPSTREAM_TIMEOUT' })
  })

  test('Step 24: resolves a supplied statisticalArea, discarding any client-supplied snapshot', async () => {
    const client = fakeReferenceDataClient()

    const resolved = await resolveGearsSection(
      [
        {
          associationId: 'gear-assoc-1',
          gear: { id: 'gear-1' },
          characteristics: [],
          statisticalArea: {
            id: 'area-1',
            codeSnapshot: 'FORGED',
            nameSnapshot: 'Forged'
          }
        }
      ],
      client,
      'correlation-1'
    )

    expect(resolved[0].statisticalArea).toEqual({
      id: 'area-1',
      codeSnapshot: '46F45',
      nameSnapshot: 'ICES 46F45'
    })
    expect(client.getStatisticalAreaById).toHaveBeenCalledWith('area-1', {
      correlationId: 'correlation-1'
    })
  })

  test('Step 24: an absent statisticalArea key leaves the resolved entry without one', async () => {
    const client = fakeReferenceDataClient()

    const resolved = await resolveGearsSection(
      [{ gear: { id: 'gear-1' }, characteristics: [] }],
      client
    )

    expect(Object.hasOwn(resolved[0], 'statisticalArea')).toBe(false)
    expect(client.getStatisticalAreaById).not.toHaveBeenCalled()
  })

  test('Step 24: an explicit null statisticalArea resolves to null without calling the reference client', async () => {
    const client = fakeReferenceDataClient()

    const resolved = await resolveGearsSection(
      [
        {
          associationId: 'gear-assoc-1',
          gear: { id: 'gear-1' },
          characteristics: [],
          statisticalArea: null
        }
      ],
      client
    )

    expect(resolved[0].statisticalArea).toBeNull()
    expect(client.getStatisticalAreaById).not.toHaveBeenCalled()
  })

  test('Step 24: aggregates a missing statistical area id into BUSINESS_VALIDATION_FAILURE', async () => {
    const client = fakeReferenceDataClient()

    await expect(
      resolveGearsSection(
        [
          {
            gear: { id: 'gear-1' },
            characteristics: [],
            statisticalArea: {}
          }
        ],
        client
      )
    ).rejects.toMatchObject({
      category: 'BUSINESS_VALIDATION_FAILURE',
      code: 'SECTION_VALIDATION_FAILED'
    })
  })

  test('Step 24: aggregates a not-found/inactive statistical area into BUSINESS_VALIDATION_FAILURE', async () => {
    const { ApplicationError } =
      await import('#/common/helpers/errors/application-error.js')
    const client = fakeReferenceDataClient({
      getStatisticalAreaById: vi.fn(async () => {
        throw new ApplicationError({
          category: 'RESOURCE_NOT_FOUND',
          message: 'The selected statistical area could not be found.'
        })
      })
    })

    await expect(
      resolveGearsSection(
        [
          {
            gear: { id: 'gear-1' },
            characteristics: [],
            statisticalArea: { id: 'missing' }
          }
        ],
        client
      )
    ).rejects.toMatchObject({
      category: 'BUSINESS_VALIDATION_FAILURE',
      code: 'SECTION_VALIDATION_FAILED'
    })
  })

  test('Step 24: rethrows an upstream statistical-area dependency failure unchanged', async () => {
    const { ApplicationError } =
      await import('#/common/helpers/errors/application-error.js')
    const client = fakeReferenceDataClient({
      getStatisticalAreaById: vi.fn(async () => {
        throw new ApplicationError({
          category: 'UPSTREAM_TIMEOUT',
          message: 'The reference data service timed out.'
        })
      })
    })

    await expect(
      resolveGearsSection(
        [
          {
            gear: { id: 'gear-1' },
            characteristics: [],
            statisticalArea: { id: 'area-1' }
          }
        ],
        client
      )
    ).rejects.toMatchObject({ category: 'UPSTREAM_TIMEOUT' })
  })

  test('does not mutate the supplied normalisedGears input', async () => {
    const client = fakeReferenceDataClient()
    const input = Object.freeze([
      Object.freeze({
        associationId: 'gear-assoc-1',
        gear: Object.freeze({ id: 'gear-1' }),
        characteristics: Object.freeze([
          Object.freeze({ characteristicId: 'char-1', value: 80 })
        ])
      })
    ])

    await expect(resolveGearsSection(input, client)).resolves.toBeDefined()
    expect(input[0].gear).toEqual({ id: 'gear-1' })
  })
})
