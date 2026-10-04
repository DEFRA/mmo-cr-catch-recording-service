import { isApplicationError } from '#/common/helpers/errors/application-error.js'

import {
  CATCH_RECORD_SECTIONS,
  isCatchRecordSection,
  normalizeCatchRecordSection
} from './catch-record-sections.js'

const APPROVED_SECTIONS = [
  'vessel',
  'trip',
  'pair-fishing',
  'gear',
  'gear-statistical-area',
  'gear-species',
  'retained-catch'
]

describe('CATCH_RECORD_SECTIONS', () => {
  test('Should contain exactly the seven approved section identifiers', () => {
    expect(Object.keys(CATCH_RECORD_SECTIONS).sort()).toEqual(
      [...APPROVED_SECTIONS].sort()
    )
  })

  test('Should be frozen', () => {
    expect(Object.isFrozen(CATCH_RECORD_SECTIONS)).toBe(true)
  })
})

describe('#isCatchRecordSection', () => {
  test.each(APPROVED_SECTIONS)(
    'Should recognise the approved section "%s"',
    (name) => {
      expect(isCatchRecordSection(name)).toBe(true)
    }
  )

  test.each(['skipper', 'trip-dates', 'ports', '__proto__', 'constructor', ''])(
    'Should not recognise the unsupported identifier "%s"',
    (name) => {
      expect(isCatchRecordSection(name)).toBe(false)
    }
  )
})

describe('#normalizeCatchRecordSection', () => {
  test('Should throw a deterministic error for an unsupported section', () => {
    try {
      normalizeCatchRecordSection('skipper', {})
      throw new Error('Expected normalizeCatchRecordSection to throw')
    } catch (error) {
      expect(isApplicationError(error)).toBe(true)
      expect(error.code).toBe('UNSUPPORTED_SECTION')
    }
  })

  test('Should normalise the vessel section without context', () => {
    const result = normalizeCatchRecordSection('vessel', {
      id: 'vessel-1',
      nameSnapshot: 'Example Vessel',
      registrationSnapshot: 'REG-1',
      externalMarkSnapshot: 'EM-1',
      lengthOverallMetres: 12.5
    })

    expect(result.id).toBe('vessel-1')
  })

  test('Should normalise the gear section without requiring context', () => {
    const result = normalizeCatchRecordSection('gear', {
      gearId: 'gear-1',
      associationId: 'assoc-1',
      codeSnapshot: 'GN',
      nameSnapshot: 'Gillnet',
      characteristics: [],
      statisticalArea: null,
      speciesCaught: []
    })

    expect(result.gearId).toBe('gear-1')
  })

  test.each(['gear-statistical-area', 'gear-species'])(
    'Should throw a deterministic error when "%s" is called without gearAssociationId context',
    (sectionName) => {
      try {
        normalizeCatchRecordSection(sectionName, { id: 'area-1' }, {})
        throw new Error('Expected normalizeCatchRecordSection to throw')
      } catch (error) {
        expect(isApplicationError(error)).toBe(true)
        expect(error.code).toBe('MISSING_GEAR_CONTEXT')
      }
    }
  )

  test('Should normalise gear-statistical-area when gearAssociationId context is supplied', () => {
    const result = normalizeCatchRecordSection(
      'gear-statistical-area',
      { id: 'area-1', code: '27', nameSnapshot: 'Area 27' },
      { gearAssociationId: 'assoc-1' }
    )

    expect(result.id).toBe('area-1')
  })

  test('Should normalise gear-species when gearAssociationId context is supplied', () => {
    const result = normalizeCatchRecordSection(
      'gear-species',
      {
        speciesId: 'species-1',
        faoCodeSnapshot: 'COD',
        nameSnapshot: 'Cod',
        attributes: []
      },
      { gearAssociationId: 'assoc-1' }
    )

    expect(result.speciesId).toBe('species-1')
  })

  test('Should return only the approved subtree for retained-catch, never another section', () => {
    const result = normalizeCatchRecordSection('retained-catch', {
      answer: 'YES',
      species: []
    })

    expect(Object.keys(result).sort()).toEqual(['answer', 'species'])
  })
})
