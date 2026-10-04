import {
  CATCH_RECORD_VALIDATION_SECTIONS,
  isCatchRecordValidationSection,
  validateCatchRecordSection
} from './catch-record-validation-sections.js'

const APPROVED_SECTIONS = [
  'vessel',
  'trip',
  'pair-fishing',
  'gear',
  'gear-statistical-area',
  'gear-species',
  'retained-catch'
]

describe('CATCH_RECORD_VALIDATION_SECTIONS', () => {
  test('Should contain exactly the seven approved section identifiers', () => {
    expect(Object.keys(CATCH_RECORD_VALIDATION_SECTIONS).sort()).toEqual(
      [...APPROVED_SECTIONS].sort()
    )
  })

  test('Should be frozen', () => {
    expect(Object.isFrozen(CATCH_RECORD_VALIDATION_SECTIONS)).toBe(true)
  })
})

describe('#isCatchRecordValidationSection', () => {
  test.each(APPROVED_SECTIONS)('Should recognise "%s"', (name) => {
    expect(isCatchRecordValidationSection(name)).toBe(true)
  })

  test.each(['skipper', '__proto__', 'constructor', ''])(
    'Should not recognise the unsupported identifier "%s"',
    (name) => {
      expect(isCatchRecordValidationSection(name)).toBe(false)
    }
  )
})

describe('#validateCatchRecordSection', () => {
  test('Should return a deterministic unsupported-section result (never throw)', () => {
    const result = validateCatchRecordSection('skipper', {})

    expect(result.isValid).toBe(false)
    expect(result.errors[0].code).toBe('UNKNOWN_FIELD')
  })

  test('Should validate the vessel section without context', () => {
    expect(
      validateCatchRecordSection('vessel', { id: 'vessel-1' }).isValid
    ).toBe(true)
  })

  test.each(['gear-statistical-area', 'gear-species'])(
    'Should require gearAssociationId context for "%s"',
    (sectionName) => {
      const result = validateCatchRecordSection(
        sectionName,
        { id: 'area-1' },
        {}
      )

      expect(result.isValid).toBe(false)
      expect(result.errors[0].path).toBe('gearAssociationId')
    }
  )

  test('Should validate gear-statistical-area when gearAssociationId is supplied', () => {
    expect(
      validateCatchRecordSection(
        'gear-statistical-area',
        { id: 'area-1', code: '27', nameSnapshot: 'Area 27' },
        { gearAssociationId: 'assoc-1' }
      ).isValid
    ).toBe(true)
  })

  test('Should validate gear-species when gearAssociationId is supplied', () => {
    expect(
      validateCatchRecordSection(
        'gear-species',
        { speciesId: 'species-1', attributes: [] },
        { gearAssociationId: 'assoc-1' }
      ).isValid
    ).toBe(true)
  })
})
