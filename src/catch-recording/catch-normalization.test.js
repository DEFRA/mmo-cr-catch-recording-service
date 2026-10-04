import { isApplicationError } from '#/common/helpers/errors/application-error.js'

import { validateCatchRecordStructureV1 } from './canonical-catch-record-contract.js'
import { createDraftCatchRecordFixture } from './canonical-catch-record-fixtures.js'
import { createCatchNormalization } from './catch-normalization.js'

describe('#createCatchNormalization', () => {
  test('Should return the expected component name', () => {
    expect(createCatchNormalization().name).toBe('CatchNormalization')
  })

  test('Should return a frozen result with no dependencies', () => {
    const normalization = createCatchNormalization()

    expect(Object.isFrozen(normalization)).toBe(true)
    expect(Object.isFrozen(normalization.dependencies)).toBe(true)
    expect(normalization.dependencies).toEqual({})
  })

  test('Should return an independent instance on every call', () => {
    expect(createCatchNormalization()).not.toBe(createCatchNormalization())
  })

  test('Should expose the approved Step 06 entry points', () => {
    const normalization = createCatchNormalization()

    expect(typeof normalization.normalizeCatchRecord).toBe('function')
    expect(typeof normalization.normalizeSection).toBe('function')
  })

  test('Two separate instances should produce deep-equal (not shared-reference) output for the same input', () => {
    const input = { vessel: { id: 'vessel-1', nameSnapshot: 'Example' } }

    const first = createCatchNormalization().normalizeCatchRecord(input)
    const second = createCatchNormalization().normalizeCatchRecord(input)

    expect(first).toEqual(second)
    expect(first).not.toBe(second)
    expect(first.vessel).not.toBe(second.vessel)
  })
})

describe('#normalizeCatchRecord', () => {
  test('Should produce only canonical business-section field names', () => {
    const result = createCatchNormalization().normalizeCatchRecord({})

    expect(Object.keys(result).sort()).toEqual(
      ['gear', 'pairFishing', 'retainedCatch', 'trip', 'vessel'].sort()
    )
  })

  test.each([
    'id',
    'catchRecordReference',
    'ownerUserId',
    'status',
    'version',
    'numberOfSubmissions',
    'hasUnsubmittedChanges',
    'audit',
    'artifacts',
    'createdAt',
    'createdBy',
    'updatedAt',
    'updatedBy',
    'submittedAt',
    'submittedBy',
    'completedAt',
    'completedBy'
  ])('Should reject an attempt to set the server-owned field "%s"', (field) => {
    try {
      createCatchNormalization().normalizeCatchRecord({ [field]: 'attempted' })
      throw new Error('Expected normalizeCatchRecord to throw')
    } catch (error) {
      expect(isApplicationError(error)).toBe(true)
      expect(error.code).toBe('SERVER_OWNED_FIELD_NOT_ALLOWED')
    }
  })

  test('Should reject an unknown root property', () => {
    try {
      createCatchNormalization().normalizeCatchRecord({ unknownField: true })
      throw new Error('Expected normalizeCatchRecord to throw')
    } catch (error) {
      expect(isApplicationError(error)).toBe(true)
      expect(error.code).toBe('UNKNOWN_PROPERTY')
    }
  })

  test('Should not mutate the caller-owned input', () => {
    const input = {
      vessel: { id: 'vessel-1', nameSnapshot: 'Example' },
      gear: [{ gearId: 'gear-1', associationId: 'assoc-1' }]
    }
    const snapshot = JSON.parse(JSON.stringify(input))

    createCatchNormalization().normalizeCatchRecord(input)

    expect(input).toEqual(snapshot)
  })

  test('Should produce a result whose business sections validate against the Step 05 v1 contract once merged onto a draft fixture', () => {
    const normalized = createCatchNormalization().normalizeCatchRecord({
      vessel: {
        id: 'vessel-1',
        nameSnapshot: 'Example Vessel',
        registrationSnapshot: 'REG-1',
        externalMarkSnapshot: 'EM-1',
        lengthOverallMetres: 12.5
      },
      gear: [
        {
          gearId: 'gear-1',
          associationId: 'assoc-1',
          codeSnapshot: 'GN',
          nameSnapshot: 'Gillnet',
          characteristics: [],
          statisticalArea: {
            id: 'area-1',
            code: '27',
            nameSnapshot: 'Area 27'
          },
          speciesCaught: []
        }
      ],
      retainedCatch: { answer: 'YES', species: [] }
    })

    const draft = createDraftCatchRecordFixture(normalized)
    const { error } = validateCatchRecordStructureV1(draft)

    expect(error).toBeUndefined()
  })
})

describe('#normalizeSection', () => {
  test('Should normalise an approved section', () => {
    const result = createCatchNormalization().normalizeSection('vessel', {
      id: 'vessel-1',
      nameSnapshot: 'Example'
    })

    expect(result.id).toBe('vessel-1')
  })

  test('Should throw a deterministic error for an unsupported section name', () => {
    try {
      createCatchNormalization().normalizeSection('bad-name', {})
      throw new Error('Expected normalizeSection to throw')
    } catch (error) {
      expect(isApplicationError(error)).toBe(true)
      expect(error.code).toBe('UNSUPPORTED_SECTION')
    }
  })

  test("Should reject a field that is not part of the section's own allow-list (achieving server-owned-field protection structurally)", () => {
    try {
      createCatchNormalization().normalizeSection('vessel', {
        id: 'v1',
        status: 'DRAFT'
      })
      throw new Error('Expected normalizeSection to throw')
    } catch (error) {
      expect(isApplicationError(error)).toBe(true)
      expect(error.code).toBe('UNKNOWN_PROPERTY')
    }
  })

  test('Should pass gearAssociationId context through to gear-specific sections', () => {
    const result = createCatchNormalization().normalizeSection(
      'gear-statistical-area',
      { id: 'area-1', code: '27', nameSnapshot: 'Area 27' },
      { gearAssociationId: 'assoc-1' }
    )

    expect(result.id).toBe('area-1')
  })
})
