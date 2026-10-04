import {
  validateGearCollection,
  validateGearEntry,
  validatePairFishingSection,
  validatePortSection,
  validateRetainedCatchSection,
  validateSpeciesCaughtEntry,
  validateStatisticalAreaSection,
  validateTripSection,
  validateVesselSection
} from './catch-record-structural-validators.js'

function buildGear(overrides = {}) {
  return {
    gearId: 'gear-1',
    associationId: 'assoc-1',
    codeSnapshot: 'GN',
    nameSnapshot: 'Gillnet',
    characteristics: [],
    statisticalArea: { id: 'area-1', code: '27', nameSnapshot: 'Area 27' },
    speciesCaught: [
      {
        speciesId: 'species-1',
        faoCodeSnapshot: 'COD',
        nameSnapshot: 'Cod',
        attributes: []
      }
    ],
    ...overrides
  }
}

describe('#validateVesselSection', () => {
  test('Should pass for a valid vessel-selection structure', () => {
    expect(
      validateVesselSection({
        id: 'vessel-1',
        nameSnapshot: 'Example',
        registrationSnapshot: 'REG-1',
        externalMarkSnapshot: 'EM-1',
        lengthOverallMetres: 12.5
      }).isValid
    ).toBe(true)
  })

  test('Should fail with an invalid vessel identifier format', () => {
    const result = validateVesselSection({ id: 42 })

    expect(result.isValid).toBe(false)
    expect(result.errors[0].code).toBe('INVALID_IDENTIFIER')
  })

  test('Should pass for a null vessel (not yet selected, incomplete draft)', () => {
    expect(validateVesselSection(null).isValid).toBe(true)
  })

  test('Should not check vessel existence or access (pure structural check only)', () => {
    // No network/database call is possible since this function takes no I/O dependency at all.
    expect(typeof validateVesselSection).toBe('function')
    expect(validateVesselSection.length).toBeLessThanOrEqual(2)
  })
})

describe('#validateTripSection', () => {
  test('Should pass for valid canonical trip values', () => {
    expect(
      validateTripSection({
        startedAndFinishedToday: true,
        dateStarted: null,
        dateEnded: null,
        departurePort: null,
        returnPort: null
      }).isValid
    ).toBe(true)
  })

  test('Should fail for an invalid boolean value', () => {
    const result = validateTripSection({ startedAndFinishedToday: 'true' })

    expect(result.errors.some((e) => e.code === 'INVALID_BOOLEAN')).toBe(true)
  })

  test('Should fail for an invalid date shape', () => {
    const result = validateTripSection({ dateStarted: 'not-a-date' })

    expect(result.errors.some((e) => e.code === 'INVALID_DATE')).toBe(true)
  })

  test('Should require explicit dates when the trip was not started and finished today', () => {
    const result = validateTripSection({
      startedAndFinishedToday: false,
      dateStarted: null,
      dateEnded: null
    })

    expect(
      result.errors.filter((e) => e.code === 'CONDITIONAL_FIELD_REQUIRED')
    ).toHaveLength(2)
  })

  test('Should not require dates when the trip was started and finished today', () => {
    const result = validateTripSection({
      startedAndFinishedToday: true,
      dateStarted: null,
      dateEnded: null
    })

    expect(
      result.errors.filter((e) => e.code === 'CONDITIONAL_FIELD_REQUIRED')
    ).toEqual([])
  })
})

describe('#validatePortSection', () => {
  test('Should pass for a valid port-selection structure', () => {
    expect(
      validatePortSection(
        { id: 'port-1', codeSnapshot: 'GBPLY', nameSnapshot: 'Plymouth' },
        'trip.departurePort'
      ).isValid
    ).toBe(true)
  })

  test('Should fail for an invalid port identifier', () => {
    const result = validatePortSection({ id: 42 }, 'trip.departurePort')

    expect(result.errors[0].code).toBe('INVALID_IDENTIFIER')
  })

  test('Should pass for a null port (not yet selected)', () => {
    expect(validatePortSection(null, 'trip.departurePort').isValid).toBe(true)
  })
})

describe('#validatePairFishingSection', () => {
  test('Should pass when disabled with empty conditional values', () => {
    expect(
      validatePairFishingSection({
        enabled: false,
        pairSkipperFullName: null,
        pairVesselRssNumber: null
      }).isValid
    ).toBe(true)
  })

  test('Should require conditional values when enabled', () => {
    const result = validatePairFishingSection({
      enabled: true,
      pairSkipperFullName: null,
      pairVesselRssNumber: null
    })

    expect(
      result.errors.filter((e) => e.code === 'CONDITIONAL_FIELD_REQUIRED')
    ).toHaveLength(2)
  })

  test('Should prohibit conditional values when disabled', () => {
    const result = validatePairFishingSection({
      enabled: false,
      pairSkipperFullName: 'Example Skipper',
      pairVesselRssNumber: null
    })

    expect(result.errors[0].code).toBe('CONDITIONAL_FIELD_PROHIBITED')
  })

  test('Should not include personal values in the validation message', () => {
    const result = validatePairFishingSection({
      enabled: false,
      pairSkipperFullName: 'Sensitive Real Name',
      pairVesselRssNumber: null
    })

    expect(JSON.stringify(result.errors)).not.toContain('Sensitive Real Name')
  })
})

describe('#validateGearEntry', () => {
  test('Should pass for a valid gear structure', () => {
    expect(validateGearEntry(buildGear(), 'gear[0]').isValid).toBe(true)
  })

  test('Should fail for an invalid gear identifier shape', () => {
    const result = validateGearEntry(buildGear({ gearId: 42 }), 'gear[0]')

    expect(result.errors.some((e) => e.code === 'INVALID_IDENTIFIER')).toBe(
      true
    )
  })

  test('Should fail for an invalid association identifier shape when supplied', () => {
    const result = validateGearEntry(
      buildGear({ associationId: 42 }),
      'gear[0]'
    )

    expect(result.errors.some((e) => e.code === 'INVALID_IDENTIFIER')).toBe(
      true
    )
  })

  test('Should scope characteristics to the correct gear path', () => {
    const result = validateGearEntry(
      buildGear({ characteristics: [{ characteristicId: 42 }] }),
      'gear[0]'
    )

    expect(
      result.errors.some((e) => e.path.startsWith('gear[0].characteristics'))
    ).toBe(true)
  })

  test('Should detect duplicate characteristic IDs within one gear', () => {
    const result = validateGearEntry(
      buildGear({
        characteristics: [
          { characteristicId: 'char-1', nameSnapshot: 'A', value: '1' },
          { characteristicId: 'char-1', nameSnapshot: 'B', value: '2' }
        ]
      }),
      'gear[0]'
    )

    expect(result.errors.some((e) => e.code === 'DUPLICATE_VALUE')).toBe(true)
  })

  test('Should detect duplicate species IDs within one gear', () => {
    const result = validateGearEntry(
      buildGear({
        speciesCaught: [
          { speciesId: 'species-1', attributes: [] },
          { speciesId: 'species-1', attributes: [] }
        ]
      }),
      'gear[0]'
    )

    expect(result.errors.some((e) => e.code === 'DUPLICATE_VALUE')).toBe(true)
  })

  test('Should keep statistical area paths identifying the correct gear', () => {
    const result = validateGearEntry(
      buildGear({ statisticalArea: { id: 42 } }),
      'gear[2]'
    )

    expect(
      result.errors.some((e) => e.path === 'gear[2].statisticalArea.id')
    ).toBe(true)
  })
})

describe('#validateStatisticalAreaSection', () => {
  test('Should pass for a valid nested area structure', () => {
    expect(
      validateStatisticalAreaSection(
        { id: 'area-1', code: '27', nameSnapshot: 'Area 27' },
        'gear[0].statisticalArea'
      ).isValid
    ).toBe(true)
  })

  test('Should pass for a null area (not yet selected)', () => {
    expect(
      validateStatisticalAreaSection(null, 'gear[0].statisticalArea').isValid
    ).toBe(true)
  })

  test('Should fail for an invalid area identifier shape', () => {
    const result = validateStatisticalAreaSection(
      { id: 42 },
      'gear[0].statisticalArea'
    )

    expect(result.errors[0].code).toBe('INVALID_IDENTIFIER')
  })
})

describe('#validateSpeciesCaughtEntry', () => {
  test('Should pass for a valid species structure', () => {
    expect(
      validateSpeciesCaughtEntry(
        {
          speciesId: 'species-1',
          faoCodeSnapshot: 'COD',
          nameSnapshot: 'Cod',
          attributes: []
        },
        'gear[0].speciesCaught[0]'
      ).isValid
    ).toBe(true)
  })

  test('Should fail for an invalid species identifier shape', () => {
    const result = validateSpeciesCaughtEntry(
      { speciesId: 42, attributes: [] },
      'gear[0].speciesCaught[0]'
    )

    expect(result.errors.some((e) => e.code === 'INVALID_IDENTIFIER')).toBe(
      true
    )
  })

  test('Should fail for an invalid attribute identifier', () => {
    const result = validateSpeciesCaughtEntry(
      { speciesId: 'species-1', attributes: [{ attributeId: 42 }] },
      'gear[0].speciesCaught[0]'
    )

    expect(result.errors.some((e) => e.code === 'INVALID_IDENTIFIER')).toBe(
      true
    )
  })

  test('Should detect duplicate attribute IDs within one species', () => {
    const result = validateSpeciesCaughtEntry(
      {
        speciesId: 'species-1',
        attributes: [
          { attributeId: 'attr-1', value: 'A' },
          { attributeId: 'attr-1', value: 'B' }
        ]
      },
      'gear[0].speciesCaught[0]'
    )

    expect(result.errors.some((e) => e.code === 'DUPLICATE_VALUE')).toBe(true)
  })
})

describe('#validateGearCollection', () => {
  test('Should pass for an independent, valid multi-gear collection', () => {
    const result = validateGearCollection([
      buildGear(),
      buildGear({ gearId: 'gear-2', associationId: 'assoc-2' })
    ])

    expect(result.isValid).toBe(true)
  })

  test('Should apply the configured collection maximum when supplied', () => {
    const result = validateGearCollection(
      [buildGear(), buildGear({ associationId: 'a2' })],
      'gear',
      {
        max: 1
      }
    )

    expect(result.errors.some((e) => e.code === 'COLLECTION_TOO_LARGE')).toBe(
      true
    )
  })

  test('Should not enforce any maximum when none is configured', () => {
    const manyGears = Array.from({ length: 50 }, (_, i) =>
      buildGear({ associationId: `assoc-${i}` })
    )

    expect(validateGearCollection(manyGears).isValid).toBe(true)
  })

  test('Should allow repeated gearId across different gear entries (not a duplicate)', () => {
    const result = validateGearCollection([
      buildGear({ gearId: 'gear-1', associationId: 'assoc-1' }),
      buildGear({ gearId: 'gear-1', associationId: 'assoc-2' })
    ])

    expect(result.isValid).toBe(true)
  })

  test('Should reject a repeated gear associationId', () => {
    const result = validateGearCollection([
      buildGear({ gearId: 'gear-1', associationId: 'dup' }),
      buildGear({ gearId: 'gear-2', associationId: 'dup' })
    ])

    expect(result.errors.some((e) => e.code === 'DUPLICATE_VALUE')).toBe(true)
  })

  test('Should keep the same species under different gears valid (not a cross-gear duplicate)', () => {
    const result = validateGearCollection([
      buildGear({ gearId: 'gear-1', associationId: 'assoc-1' }),
      buildGear({ gearId: 'gear-2', associationId: 'assoc-2' })
    ])

    expect(result.isValid).toBe(true)
  })

  test('Should produce independent gear array index paths', () => {
    const result = validateGearCollection([
      buildGear({ gearId: 42, associationId: 'assoc-1' }),
      buildGear({ gearId: 42, associationId: 'assoc-2' })
    ])

    expect(result.errors.some((e) => e.path === 'gear[0].gearId')).toBe(true)
    expect(result.errors.some((e) => e.path === 'gear[1].gearId')).toBe(true)
  })

  test('Should not mutate ordering or remove duplicate entries', () => {
    const gearArray = [
      buildGear({ associationId: 'dup' }),
      buildGear({ associationId: 'dup' })
    ]
    const snapshot = JSON.parse(JSON.stringify(gearArray))

    validateGearCollection(gearArray)

    expect(gearArray).toEqual(snapshot)
  })
})

describe('#validateRetainedCatchSection', () => {
  test('Should pass for an approved answer value', () => {
    expect(
      validateRetainedCatchSection({ answer: 'YES', species: [] }).isValid
    ).toBe(true)
  })

  test('Should fail for an unsupported answer value', () => {
    const result = validateRetainedCatchSection({
      answer: 'MAYBE',
      species: []
    })

    expect(result.errors.some((e) => e.code === 'INVALID_ENUM_VALUE')).toBe(
      true
    )
  })

  test('Should not check retained-species eligibility against caught species', () => {
    expect(
      validateRetainedCatchSection({
        answer: 'YES',
        species: [{ anything: true }]
      }).isValid
    ).toBe(true)
  })

  test('Should pass for a null retainedCatch (not yet selected)', () => {
    expect(validateRetainedCatchSection(null).isValid).toBe(true)
  })
})

describe('Security and defensive behaviour', () => {
  test('Should not be affected by prototype-pollution keys', () => {
    const malicious = JSON.parse('{"__proto__": {"polluted": true}}')

    expect(() => validateVesselSection(malicious)).not.toThrow()
    expect({}.polluted).toBeUndefined()
  })

  test('Should not trigger uncontrolled recursion on a deeply unsupported object', () => {
    let deep = { value: 'leaf' }
    for (let i = 0; i < 1000; i += 1) {
      deep = { nested: deep }
    }

    expect(() => validateVesselSection(deep)).not.toThrow()
  })

  test('Should short-circuit on a parent type mismatch rather than cascade child errors', () => {
    const result = validateGearEntry('not-an-object', 'gear[0]')

    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].code).toBe('INVALID_TYPE')
  })
})
