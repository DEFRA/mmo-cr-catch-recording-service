import { reconcileGears } from './reconcile-gears.js'

function resolvedGear(overrides = {}) {
  return {
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
    ],
    ...overrides
  }
}

function existingGear(overrides = {}) {
  return {
    associationId: 'gear-assoc-1',
    gear: { id: 'gear-1', codeSnapshot: 'OLD_CODE', nameSnapshot: 'Old Name' },
    characteristics: [],
    statisticalArea: {
      id: 'area-1',
      codeSnapshot: 'A1',
      nameSnapshot: 'Area One'
    },
    speciesCaught: [
      {
        id: 'species-1',
        faoCodeSnapshot: 'COD',
        nameSnapshot: 'Cod',
        weightAboveMinimumKg: 5
      }
    ],
    ...overrides
  }
}

describe('#reconcileGears', () => {
  test('retains an existing gear association, refreshing its snapshot and preserving nested data', () => {
    const existing = existingGear()

    const { gears, removedAssociationIds } = reconcileGears({
      resolvedIncomingGears: [resolvedGear({ associationId: 'gear-assoc-1' })],
      existingGears: [existing],
      generateAssociationId: () => 'should-not-be-called'
    })

    expect(gears).toHaveLength(1)
    expect(gears[0]).toEqual({
      associationId: 'gear-assoc-1',
      gear: {
        id: 'gear-1',
        codeSnapshot: 'GEAR001',
        nameSnapshot: 'Otter trawl'
      },
      characteristics: resolvedGear().characteristics,
      statisticalArea: existing.statisticalArea,
      speciesCaught: existing.speciesCaught
    })
    expect(removedAssociationIds).toEqual([])
  })

  test('adds a new gear association with a server-generated associationId and no nested data', () => {
    let callCount = 0
    const generateAssociationId = () => {
      callCount += 1
      return `generated-${callCount}`
    }

    const { gears, removedAssociationIds } = reconcileGears({
      resolvedIncomingGears: [resolvedGear()],
      existingGears: [],
      generateAssociationId
    })

    expect(gears).toEqual([
      {
        associationId: 'generated-1',
        gear: resolvedGear().gear,
        characteristics: resolvedGear().characteristics,
        speciesCaught: []
      }
    ])
    expect(removedAssociationIds).toEqual([])
  })

  test('defaults generateAssociationId to randomUUID when not supplied', () => {
    const { gears } = reconcileGears({
      resolvedIncomingGears: [resolvedGear()],
      existingGears: []
    })

    expect(gears[0].associationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    )
  })

  test('drops an existing gear association that was not retained, reporting it as removed', () => {
    const retained = existingGear({ associationId: 'gear-assoc-1' })
    const removed = existingGear({
      associationId: 'gear-assoc-2',
      gear: { id: 'gear-2', codeSnapshot: 'G2', nameSnapshot: 'Gear 2' }
    })

    const { gears, removedAssociationIds } = reconcileGears({
      resolvedIncomingGears: [resolvedGear({ associationId: 'gear-assoc-1' })],
      existingGears: [retained, removed],
      generateAssociationId: () => 'unused'
    })

    expect(gears).toHaveLength(1)
    expect(gears[0].associationId).toBe('gear-assoc-1')
    expect(gears.some((gear) => gear.associationId === 'gear-assoc-2')).toBe(
      false
    )
    expect(removedAssociationIds).toEqual(['gear-assoc-2'])
  })

  test('preserves the deterministic order of resolvedIncomingGears in the output', () => {
    const existingA = existingGear({ associationId: 'gear-assoc-a' })
    const existingB = existingGear({
      associationId: 'gear-assoc-b',
      gear: { id: 'gear-b', codeSnapshot: 'B', nameSnapshot: 'Gear B' }
    })

    const { gears } = reconcileGears({
      resolvedIncomingGears: [
        resolvedGear({ associationId: 'gear-assoc-b' }),
        resolvedGear(),
        resolvedGear({ associationId: 'gear-assoc-a' })
      ],
      existingGears: [existingA, existingB],
      generateAssociationId: () => 'generated-new'
    })

    expect(gears.map((gear) => gear.associationId)).toEqual([
      'gear-assoc-b',
      'generated-new',
      'gear-assoc-a'
    ])
  })

  test('throws BUSINESS_VALIDATION_FAILURE/SECTION_VALIDATION_FAILED for an unknown/forged associationId', () => {
    let thrown

    try {
      reconcileGears({
        resolvedIncomingGears: [
          resolvedGear({ associationId: 'unknown-assoc' })
        ],
        existingGears: [],
        generateAssociationId: () => 'should-not-be-called'
      })
      throw new Error('expected reconcileGears to throw')
    } catch (error) {
      thrown = error
    }

    expect(thrown.category).toBe('BUSINESS_VALIDATION_FAILURE')
    expect(thrown.code).toBe('SECTION_VALIDATION_FAILED')
  })

  test('aggregates every unknown/forged associationId into a single thrown error', () => {
    try {
      reconcileGears({
        resolvedIncomingGears: [
          resolvedGear({ associationId: 'unknown-1' }),
          resolvedGear({ associationId: 'unknown-2' })
        ],
        existingGears: []
      })
      throw new Error('expected reconcileGears to throw')
    } catch (error) {
      expect(error.details).toHaveLength(2)
      expect(error.details[0].code).toBe('INVALID_REFERENCE')
      expect(error.details[1].code).toBe('INVALID_REFERENCE')
    }
  })

  test('never mutates resolvedIncomingGears, existingGears, or their nested objects', () => {
    const existing = Object.freeze(existingGear())
    const incoming = Object.freeze([
      Object.freeze(resolvedGear({ associationId: 'gear-assoc-1' }))
    ])
    const existingGearsInput = Object.freeze([existing])

    expect(() =>
      reconcileGears({
        resolvedIncomingGears: incoming,
        existingGears: existingGearsInput,
        generateAssociationId: () => 'generated'
      })
    ).not.toThrow()

    expect(existing.gear.codeSnapshot).toBe('OLD_CODE')
    expect(incoming[0].gear.codeSnapshot).toBe('GEAR001')
  })

  test('produces a new, independent gears array and gear objects (not the same references as either input)', () => {
    const existing = existingGear()
    const resolvedIncomingGears = [
      resolvedGear({ associationId: 'gear-assoc-1' })
    ]
    const existingGears = [existing]

    const { gears } = reconcileGears({ resolvedIncomingGears, existingGears })

    expect(gears).not.toBe(resolvedIncomingGears)
    expect(gears).not.toBe(existingGears)
    expect(gears[0]).not.toBe(existing)
    expect(gears[0]).not.toBe(resolvedIncomingGears[0])
  })

  test('omits statisticalArea for a retained gear when the persisted association had none', () => {
    const existing = existingGear()
    delete existing.statisticalArea

    const { gears } = reconcileGears({
      resolvedIncomingGears: [resolvedGear({ associationId: 'gear-assoc-1' })],
      existingGears: [existing]
    })

    expect(Object.hasOwn(gears[0], 'statisticalArea')).toBe(false)
  })

  test('Step 24: replaces a retained gear statisticalArea when the resolved entry supplies one', () => {
    const existing = existingGear()
    const newArea = {
      id: 'area-2',
      codeSnapshot: 'A2',
      nameSnapshot: 'Area Two'
    }

    const { gears } = reconcileGears({
      resolvedIncomingGears: [
        resolvedGear({
          associationId: 'gear-assoc-1',
          statisticalArea: newArea
        })
      ],
      existingGears: [existing]
    })

    expect(gears[0].statisticalArea).toEqual(newArea)
  })

  test('Step 24: clears a retained gear statisticalArea when the resolved entry supplies null', () => {
    const existing = existingGear()

    const { gears } = reconcileGears({
      resolvedIncomingGears: [
        resolvedGear({ associationId: 'gear-assoc-1', statisticalArea: null })
      ],
      existingGears: [existing]
    })

    expect(gears[0].statisticalArea).toBeNull()
  })

  test('Step 24: a new gear may be given a statisticalArea in the same save', () => {
    const newArea = {
      id: 'area-3',
      codeSnapshot: 'A3',
      nameSnapshot: 'Area Three'
    }

    const { gears } = reconcileGears({
      resolvedIncomingGears: [resolvedGear({ statisticalArea: newArea })],
      existingGears: [],
      generateAssociationId: () => 'generated-new'
    })

    expect(gears[0].statisticalArea).toEqual(newArea)
  })

  test('Step 24: a new gear with no supplied statisticalArea has no statisticalArea key', () => {
    const { gears } = reconcileGears({
      resolvedIncomingGears: [resolvedGear()],
      existingGears: [],
      generateAssociationId: () => 'generated-new'
    })

    expect(Object.hasOwn(gears[0], 'statisticalArea')).toBe(false)
  })

  test('Step 24: one gear receiving a statisticalArea does not affect another gear in the same save', () => {
    const existingA = existingGear({ associationId: 'gear-assoc-a' })
    const existingB = existingGear({
      associationId: 'gear-assoc-b',
      gear: { id: 'gear-b', codeSnapshot: 'B', nameSnapshot: 'Gear B' },
      statisticalArea: {
        id: 'area-b',
        codeSnapshot: 'AB',
        nameSnapshot: 'Area B'
      }
    })
    const newArea = {
      id: 'area-2',
      codeSnapshot: 'A2',
      nameSnapshot: 'Area Two'
    }

    const { gears } = reconcileGears({
      resolvedIncomingGears: [
        resolvedGear({
          associationId: 'gear-assoc-a',
          statisticalArea: newArea
        }),
        resolvedGear({ associationId: 'gear-assoc-b' })
      ],
      existingGears: [existingA, existingB]
    })

    const gearA = gears.find((gear) => gear.associationId === 'gear-assoc-a')
    const gearB = gears.find((gear) => gear.associationId === 'gear-assoc-b')

    expect(gearA.statisticalArea).toEqual(newArea)
    expect(gearB.statisticalArea).toEqual(existingB.statisticalArea)
  })

  test('defaults speciesCaught to an empty array for a retained gear whose persisted association had none', () => {
    const existing = existingGear()
    delete existing.speciesCaught

    const { gears } = reconcileGears({
      resolvedIncomingGears: [resolvedGear({ associationId: 'gear-assoc-1' })],
      existingGears: [existing]
    })

    expect(gears[0].speciesCaught).toEqual([])
  })

  test('Step 27: a new gear may be given speciesCaught in the same save', () => {
    const { gears } = reconcileGears({
      resolvedIncomingGears: [
        resolvedGear({
          speciesCaught: [{ id: 'species-1', weightAboveMinimumKg: 5 }]
        })
      ],
      existingGears: [],
      generateAssociationId: () => 'generated-new'
    })

    expect(gears[0].speciesCaught).toHaveLength(1)
    expect(gears[0].speciesCaught[0]).toEqual({
      id: 'species-1',
      weightAboveMinimumKg: 5
    })
  })

  test("Step 27: a retained gear's speciesCaught is replaced wholesale by whatever the resolved entry supplies", () => {
    const existing = existingGear()

    const { gears } = reconcileGears({
      resolvedIncomingGears: [
        resolvedGear({
          associationId: 'gear-assoc-1',
          speciesCaught: [{ id: 'species-1', weightBelowMinimumKg: 2 }]
        })
      ],
      existingGears: [existing]
    })

    expect(gears[0].speciesCaught).toEqual([
      { id: 'species-1', weightBelowMinimumKg: 2 }
    ])
  })
})
