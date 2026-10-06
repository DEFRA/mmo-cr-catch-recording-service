import { isGearComplete, evaluateGearsProgress } from './gear-completeness.js'

function completeGear(overrides = {}) {
  return {
    associationId: 'gear-assoc-1',
    gear: { id: 'gear-1', codeSnapshot: 'TBB', nameSnapshot: 'Beam Trawl' },
    characteristics: [{ characteristicId: 'char-1', value: 2 }],
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
        weightAboveMinimumKg: 5,
        weightBelowMinimumKg: null,
        weightLegallyDiscardedKg: null,
        weightPrecision: 'wholeNumber'
      }
    ],
    ...overrides
  }
}

describe('#isGearComplete', () => {
  test('is complete when every dimension passes', () => {
    expect(isGearComplete(completeGear())).toBe(true)
  })

  test('is incomplete when characteristics is empty', () => {
    expect(isGearComplete(completeGear({ characteristics: [] }))).toBe(false)
  })

  test('is incomplete when characteristics is missing entirely', () => {
    const gear = completeGear()
    delete gear.characteristics
    expect(isGearComplete(gear)).toBe(false)
  })

  test('is incomplete when statisticalArea is absent', () => {
    const gear = completeGear()
    delete gear.statisticalArea
    expect(isGearComplete(gear)).toBe(false)
  })

  test('is incomplete when statisticalArea is null', () => {
    expect(isGearComplete(completeGear({ statisticalArea: null }))).toBe(false)
  })

  test('is incomplete when statisticalArea is malformed (array, not object)', () => {
    expect(isGearComplete(completeGear({ statisticalArea: ['area-1'] }))).toBe(
      false
    )
  })

  test('is incomplete when statisticalArea lacks an id', () => {
    expect(isGearComplete(completeGear({ statisticalArea: {} }))).toBe(false)
  })

  test('is incomplete when speciesCaught is empty (no species under this gear)', () => {
    expect(isGearComplete(completeGear({ speciesCaught: [] }))).toBe(false)
  })

  test('is incomplete when speciesCaught is missing entirely', () => {
    const gear = completeGear()
    delete gear.speciesCaught
    expect(isGearComplete(gear)).toBe(false)
  })

  test('is incomplete when a species entry has no weight fields at all', () => {
    expect(
      isGearComplete(
        completeGear({
          speciesCaught: [{ id: 'species-1' }]
        })
      )
    ).toBe(false)
  })

  test('is incomplete when a species entry has every weight field null', () => {
    expect(
      isGearComplete(
        completeGear({
          speciesCaught: [
            {
              id: 'species-1',
              weightAboveMinimumKg: null,
              weightBelowMinimumKg: null,
              weightLegallyDiscardedKg: null
            }
          ]
        })
      )
    ).toBe(false)
  })

  test('is incomplete when only one of several species entries lacks a weight value', () => {
    expect(
      isGearComplete(
        completeGear({
          speciesCaught: [
            { id: 'species-1', weightAboveMinimumKg: 5 },
            { id: 'species-2' }
          ]
        })
      )
    ).toBe(false)
  })

  test('is complete when every species entry has at least one weight value (any field)', () => {
    expect(
      isGearComplete(
        completeGear({
          speciesCaught: [{ id: 'species-1', weightLegallyDiscardedKg: 1 }]
        })
      )
    ).toBe(true)
  })

  test('returns false for a malformed (non-object) gear rather than crash', () => {
    expect(isGearComplete(null)).toBe(false)
    expect(isGearComplete(undefined)).toBe(false)
    expect(isGearComplete('not-an-object')).toBe(false)
    expect(isGearComplete(['array'])).toBe(false)
  })

  test('does not mutate the supplied gear', () => {
    const gear = Object.freeze(completeGear())
    expect(() => isGearComplete(gear)).not.toThrow()
  })
})

describe('#evaluateGearsProgress', () => {
  test('reports allGearsComplete true and no incomplete IDs when every gear is complete', () => {
    const result = evaluateGearsProgress([
      completeGear({ associationId: 'gear-assoc-1' }),
      completeGear({ associationId: 'gear-assoc-2' })
    ])

    expect(result).toEqual({
      incompleteGearAssociationIds: [],
      currentIncompleteGearAssociationId: null,
      allGearsComplete: true
    })
  })

  test('reports allGearsComplete false when the gears collection is empty', () => {
    expect(evaluateGearsProgress([])).toEqual({
      incompleteGearAssociationIds: [],
      currentIncompleteGearAssociationId: null,
      allGearsComplete: false
    })
  })

  test('treats a non-array/absent value defensively as an empty collection', () => {
    const expected = {
      incompleteGearAssociationIds: [],
      currentIncompleteGearAssociationId: null,
      allGearsComplete: false
    }

    expect(evaluateGearsProgress(undefined)).toEqual(expected)
    expect(evaluateGearsProgress(null)).toEqual(expected)
    expect(evaluateGearsProgress('not-an-array')).toEqual(expected)
  })

  test('returns the single incomplete gear as the current incomplete gear', () => {
    const result = evaluateGearsProgress([
      completeGear({ associationId: 'gear-assoc-1' }),
      completeGear({ associationId: 'gear-assoc-2', statisticalArea: null })
    ])

    expect(result.incompleteGearAssociationIds).toEqual(['gear-assoc-2'])
    expect(result.currentIncompleteGearAssociationId).toBe('gear-assoc-2')
    expect(result.allGearsComplete).toBe(false)
  })

  test('returns null for currentIncompleteGearAssociationId when multiple gears are incomplete', () => {
    const result = evaluateGearsProgress([
      completeGear({ associationId: 'gear-assoc-1', statisticalArea: null }),
      completeGear({ associationId: 'gear-assoc-2', speciesCaught: [] })
    ])

    expect(result.incompleteGearAssociationIds).toEqual([
      'gear-assoc-1',
      'gear-assoc-2'
    ])
    expect(result.currentIncompleteGearAssociationId).toBeNull()
    expect(result.allGearsComplete).toBe(false)
  })

  test('preserves canonical array order in incompleteGearAssociationIds', () => {
    const result = evaluateGearsProgress([
      completeGear({ associationId: 'gear-assoc-b', statisticalArea: null }),
      completeGear({ associationId: 'gear-assoc-a', statisticalArea: null })
    ])

    expect(result.incompleteGearAssociationIds).toEqual([
      'gear-assoc-b',
      'gear-assoc-a'
    ])
  })

  test('one complete and one incomplete gear are each evaluated independently (cross-gear isolation)', () => {
    const result = evaluateGearsProgress([
      completeGear({ associationId: 'gear-assoc-1' }),
      completeGear({ associationId: 'gear-assoc-2', characteristics: [] })
    ])

    expect(result.incompleteGearAssociationIds).toEqual(['gear-assoc-2'])
    expect(result.allGearsComplete).toBe(false)
  })

  test("cross-gear isolation: another gear being complete never substitutes for this gear's own missing dimension", () => {
    const otherGearStatisticalArea = { id: 'area-9' }
    const result = evaluateGearsProgress([
      completeGear({
        associationId: 'gear-assoc-1',
        statisticalArea: otherGearStatisticalArea
      }),
      completeGear({ associationId: 'gear-assoc-2', statisticalArea: null })
    ])

    expect(result.incompleteGearAssociationIds).toEqual(['gear-assoc-2'])
  })

  test('the same authoritative species under different gears is evaluated independently', () => {
    const sharedSpeciesId = 'species-shared'
    const result = evaluateGearsProgress([
      completeGear({
        associationId: 'gear-assoc-1',
        speciesCaught: [{ id: sharedSpeciesId, weightAboveMinimumKg: 5 }]
      }),
      completeGear({
        associationId: 'gear-assoc-2',
        speciesCaught: [{ id: sharedSpeciesId }]
      })
    ])

    expect(result.incompleteGearAssociationIds).toEqual(['gear-assoc-2'])
  })

  test('ignores a gear association with no own associationId when reporting incomplete IDs, but still prevents allGearsComplete', () => {
    const result = evaluateGearsProgress([
      completeGear({ associationId: undefined, statisticalArea: null })
    ])

    expect(result.incompleteGearAssociationIds).toEqual([])
    expect(result.allGearsComplete).toBe(false)
  })

  test('does not mutate or reorder the supplied gears collection', () => {
    const gears = Object.freeze([
      Object.freeze(completeGear({ associationId: 'gear-assoc-1' })),
      Object.freeze(completeGear({ associationId: 'gear-assoc-2' }))
    ])

    expect(() => evaluateGearsProgress(gears)).not.toThrow()
    expect(gears.map((gear) => gear.associationId)).toEqual([
      'gear-assoc-1',
      'gear-assoc-2'
    ])
  })

  test('produces a frozen, deterministic result for equivalent input', () => {
    const gears = [completeGear({ associationId: 'gear-assoc-1' })]

    const first = evaluateGearsProgress(gears)
    const second = evaluateGearsProgress(gears)

    expect(first).toEqual(second)
    expect(Object.isFrozen(first)).toBe(true)
    expect(Object.isFrozen(first.incompleteGearAssociationIds)).toBe(true)
  })

  test('never calls the Reference Data Service or any dependency (pure synchronous function)', () => {
    // No referenceDataClient/correlationId parameter exists on this function at all - this test simply
    // documents and asserts the function's purity: it returns a plain, non-Promise value synchronously.
    const result = evaluateGearsProgress([completeGear()])
    expect(result).not.toBeInstanceOf(Promise)
  })
})
