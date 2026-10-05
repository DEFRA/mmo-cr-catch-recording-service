import { CANONICAL_SCHEMA_VERSION } from '../domain/canonical-catch-record.js'
import {
  newDraftExample,
  submittedExample
} from '../domain/__fixtures__/canonical-catch-record.fixtures.js'
import {
  toCanonicalRecord,
  toPersistenceDocument
} from './catch-record-mapper.js'

/**
 * A second gear association, structurally distinct from the fixture's own gear, sharing the same
 * authoritative species reference ID so the per-gear independence rule (canonical doc §4.4: "the same
 * species may be present under different gears") can be exercised explicitly.
 */
function secondGearWithSharedSpecies() {
  return {
    associationId: 'c6db38e3-9f70-4a31-b6b9-e5867930c555',
    gear: {
      id: '7a2b5c1d-0000-4000-8000-000000000001',
      codeSnapshot: 'GND',
      nameSnapshot: 'Gill Net'
    },
    characteristics: [
      {
        characteristicId: 'number-of-nets',
        nameSnapshot: 'Number of Nets',
        value: 10
      }
    ],
    statisticalArea: {
      id: '7a2b5c1d-0000-4000-8000-000000000002',
      codeSnapshot: '27.7.e',
      nameSnapshot: 'ICES 27.7.e'
    },
    speciesCaught: [
      {
        associationId: '7a2b5c1d-0000-4000-8000-000000000003',
        species: {
          // Same authoritative species ID as the fixture's first gear's species, under a different
          // gear association.
          id: '60628fcb-97af-40d0-b992-099216c8fc40',
          faoCodeSnapshot: 'COD',
          nameSnapshot: 'Atlantic Cod'
        },
        catchDetails: [
          {
            attributeId: 'LSC',
            nameSnapshot: 'Weight Above Minimum Size Kept Onboard',
            value: 12,
            unitSnapshot: 'kg'
          }
        ]
      }
    ]
  }
}

function multiGearCatchRecord() {
  return {
    ...structuredClone(newDraftExample),
    gears: [
      ...structuredClone(newDraftExample.gears),
      secondGearWithSharedSpecies()
    ]
  }
}

describe('#catch-record-mapper', () => {
  describe('toPersistenceDocument', () => {
    test('Should map every root field explicitly, using canonical id as _id', () => {
      const document = toPersistenceDocument(newDraftExample)

      expect(document._id).toBe(newDraftExample.id)
      expect(document).not.toHaveProperty('id')
      expect(document.schemaVersion).toBe(newDraftExample.schemaVersion)
      expect(document.catchRecordReference).toBe(
        newDraftExample.catchRecordReference
      )
      expect(document.ownerUserId).toBe(newDraftExample.ownerUserId)
      expect(document.status).toBe(newDraftExample.status)
      expect(document.version).toBe(newDraftExample.version)
      expect(document.numberOfSubmissions).toBe(
        newDraftExample.numberOfSubmissions
      )
      expect(document.hasUnsubmittedChanges).toBe(
        newDraftExample.hasUnsubmittedChanges
      )
      expect(document.vessel).toEqual(newDraftExample.vessel)
      expect(document.trip).toEqual(newDraftExample.trip)
      expect(document.pairFishing).toEqual(newDraftExample.pairFishing)
      expect(document.gears).toEqual(newDraftExample.gears)
      expect(document.landing).toEqual(newDraftExample.landing)
      expect(document.artifacts).toEqual(newDraftExample.artifacts)
      expect(document.createdAt).toBe(newDraftExample.createdAt)
      expect(document.createdBy).toBe(newDraftExample.createdBy)
      expect(document.updatedAt).toBe(newDraftExample.updatedAt)
      expect(document.updatedBy).toBe(newDraftExample.updatedBy)
      expect(document.submittedAt).toBe(newDraftExample.submittedAt)
      expect(document.submittedBy).toBe(newDraftExample.submittedBy)
      expect(document.completedAt).toBe(newDraftExample.completedAt)
      expect(document.completedBy).toBe(newDraftExample.completedBy)
    })

    test('Should preserve the per-gear hierarchy and multiple gears', () => {
      const record = multiGearCatchRecord()
      const document = toPersistenceDocument(record)

      expect(document.gears).toHaveLength(2)
      expect(document.gears[1].speciesCaught[0].species.id).toBe(
        record.gears[0].speciesCaught[0].species.id
      )
    })

    test('Should not mutate the canonical input', () => {
      const record = structuredClone(newDraftExample)
      const snapshot = structuredClone(record)

      toPersistenceDocument(record)

      expect(record).toEqual(snapshot)
    })

    test('Should not share mutable nested references with the input', () => {
      const record = structuredClone(newDraftExample)
      const document = toPersistenceDocument(record)

      document.gears[0].characteristics[0].value = 999
      document.vessel.nameSnapshot = 'MUTATED'

      expect(record.gears[0].characteristics[0].value).not.toBe(999)
      expect(record.vessel.nameSnapshot).not.toBe('MUTATED')
    })

    test('Should not add generated timestamps, actors, or defaults', () => {
      const document = toPersistenceDocument(newDraftExample)
      const expectedKeys = [
        '_id',
        'schemaVersion',
        'catchRecordReference',
        'ownerUserId',
        'status',
        'version',
        'numberOfSubmissions',
        'hasUnsubmittedChanges',
        'createdAt',
        'createdBy',
        'updatedAt',
        'updatedBy',
        'submittedAt',
        'submittedBy',
        'completedAt',
        'completedBy',
        'vessel',
        'trip',
        'pairFishing',
        'gears',
        'landing',
        'artifacts'
      ]

      expect(Object.keys(document).sort()).toEqual(expectedKeys.sort())
    })
  })

  describe('toCanonicalRecord', () => {
    test('Should map a complete valid document back to the canonical record', () => {
      const document = toPersistenceDocument(submittedExample)
      const canonical = toCanonicalRecord(document)

      expect(canonical).toEqual(submittedExample)
    })

    test('Should preserve the per-gear hierarchy with independent same-species entries', () => {
      const record = multiGearCatchRecord()
      const document = toPersistenceDocument(record)
      const canonical = toCanonicalRecord(document)

      expect(canonical.gears).toHaveLength(2)
      expect(canonical.gears[0].speciesCaught[0].catchDetails[0].value).toBe(5)
      expect(canonical.gears[1].speciesCaught[0].catchDetails[0].value).toBe(12)
    })

    test('Should exclude MongoDB-specific _id from canonical output', () => {
      const document = toPersistenceDocument(newDraftExample)
      const canonical = toCanonicalRecord(document)

      expect(canonical).not.toHaveProperty('_id')
      expect(canonical.id).toBe(newDraftExample.id)
    })

    test('Should not let an unknown stored field leak into canonical output', () => {
      const document = {
        ...toPersistenceDocument(newDraftExample),
        unexpectedLegacyField: 'should not appear'
      }

      const canonical = toCanonicalRecord(document)

      expect(canonical).not.toHaveProperty('unexpectedLegacyField')
    })

    test('Should not mutate the stored document', () => {
      const document = toPersistenceDocument(newDraftExample)
      const snapshot = structuredClone(document)

      toCanonicalRecord(document)

      expect(document).toEqual(snapshot)
    })

    test('Should not share mutable nested references with the stored document', () => {
      const document = toPersistenceDocument(newDraftExample)
      const canonical = toCanonicalRecord(document)

      canonical.gears[0].characteristics[0].value = 999

      expect(document.gears[0].characteristics[0].value).not.toBe(999)
    })

    test('Should reject a non-object document', () => {
      expect(() => toCanonicalRecord(null)).toThrow(TypeError)
      expect(() => toCanonicalRecord('not-an-object')).toThrow(TypeError)
    })

    test('Should reject an unsupported schemaVersion rather than fall back', () => {
      const document = {
        ...toPersistenceDocument(newDraftExample),
        schemaVersion: CANONICAL_SCHEMA_VERSION + 1
      }

      expect(() => toCanonicalRecord(document)).toThrow(TypeError)
    })

    test('Should reject a missing/invalid _id, catchRecordReference, or ownerUserId', () => {
      const base = toPersistenceDocument(newDraftExample)

      expect(() => toCanonicalRecord({ ...base, _id: '' })).toThrow(TypeError)
      expect(() =>
        toCanonicalRecord({ ...base, catchRecordReference: null })
      ).toThrow(TypeError)
      expect(() => toCanonicalRecord({ ...base, ownerUserId: 42 })).toThrow(
        TypeError
      )
    })

    test('Should reject an unrecognised status', () => {
      const document = {
        ...toPersistenceDocument(newDraftExample),
        status: 'ABANDONED'
      }

      expect(() => toCanonicalRecord(document)).toThrow(TypeError)
    })

    test('Should reject a non-array gears collection', () => {
      const document = {
        ...toPersistenceDocument(newDraftExample),
        gears: 'not-an-array'
      }

      expect(() => toCanonicalRecord(document)).toThrow(TypeError)
    })
  })
})
