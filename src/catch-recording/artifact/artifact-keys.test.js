import {
  buildArtifactKey,
  contentTypeForArtifactType,
  isSupportedArtifactType,
  resolvePublicArtifactType,
  publicArtifactTypeFor,
  ARTIFACT_TYPES
} from './artifact-keys.js'

const CATCH_RECORD_ID = '5f9c6586-3bf0-4fbb-95d8-ef2cf9c1d9af'

describe('#buildArtifactKey', () => {
  test('Should build the deterministic JSON snapshot key', () => {
    expect(
      buildArtifactKey({
        catchRecordId: CATCH_RECORD_ID,
        submissionNumber: 1,
        type: ARTIFACT_TYPES.JSON_SNAPSHOT
      })
    ).toBe(`catch-records/${CATCH_RECORD_ID}/submissions/1/snapshot.json`)
  })

  test('Should build the deterministic PDF receipt key', () => {
    expect(
      buildArtifactKey({
        catchRecordId: CATCH_RECORD_ID,
        submissionNumber: 2,
        type: ARTIFACT_TYPES.PDF_RECEIPT
      })
    ).toBe(`catch-records/${CATCH_RECORD_ID}/submissions/2/receipt.pdf`)
  })

  test('Should be deterministic for the same inputs', () => {
    const input = {
      catchRecordId: CATCH_RECORD_ID,
      submissionNumber: 3,
      type: ARTIFACT_TYPES.JSON_SNAPSHOT
    }
    expect(buildArtifactKey(input)).toBe(buildArtifactKey(input))
  })

  test('Should reject a path-traversal/object-key-injection catchRecordId', () => {
    expect(() =>
      buildArtifactKey({
        catchRecordId: '../../etc/passwd',
        submissionNumber: 1,
        type: ARTIFACT_TYPES.JSON_SNAPSHOT
      })
    ).toThrow(TypeError)
  })

  test('Should accept a non-UUID safe bounded identifier (e.g. a test fixture id)', () => {
    expect(
      buildArtifactKey({
        catchRecordId: 'record-1',
        submissionNumber: 1,
        type: ARTIFACT_TYPES.JSON_SNAPSHOT
      })
    ).toBe('catch-records/record-1/submissions/1/snapshot.json')
  })

  test('Should reject a zero, negative, fractional, or oversized submission number', () => {
    for (const submissionNumber of [0, -1, 1.5, 1001, Number.NaN]) {
      expect(() =>
        buildArtifactKey({
          catchRecordId: CATCH_RECORD_ID,
          submissionNumber,
          type: ARTIFACT_TYPES.JSON_SNAPSHOT
        })
      ).toThrow(TypeError)
    }
  })

  test('Should reject an unsupported artifact type', () => {
    expect(() =>
      buildArtifactKey({
        catchRecordId: CATCH_RECORD_ID,
        submissionNumber: 1,
        type: 'EXE_PAYLOAD'
      })
    ).toThrow(TypeError)
  })
})

describe('#contentTypeForArtifactType', () => {
  test('Should return the safe JSON content type', () => {
    expect(contentTypeForArtifactType(ARTIFACT_TYPES.JSON_SNAPSHOT)).toBe(
      'application/json; charset=utf-8'
    )
  })

  test('Should return the safe PDF content type', () => {
    expect(contentTypeForArtifactType(ARTIFACT_TYPES.PDF_RECEIPT)).toBe(
      'application/pdf'
    )
  })

  test('Should reject an unsupported type', () => {
    expect(() => contentTypeForArtifactType('csv')).toThrow(TypeError)
  })
})

describe('#isSupportedArtifactType', () => {
  test('Should accept both approved types', () => {
    expect(isSupportedArtifactType(ARTIFACT_TYPES.JSON_SNAPSHOT)).toBe(true)
    expect(isSupportedArtifactType(ARTIFACT_TYPES.PDF_RECEIPT)).toBe(true)
  })

  test('Should reject anything else', () => {
    expect(isSupportedArtifactType('json')).toBe(false)
    expect(isSupportedArtifactType(undefined)).toBe(false)
  })
})

describe('#resolvePublicArtifactType', () => {
  test('Should map the public "json" segment to JSON_SNAPSHOT', () => {
    expect(resolvePublicArtifactType('json')).toBe(ARTIFACT_TYPES.JSON_SNAPSHOT)
  })

  test('Should map the public "pdf" segment to PDF_RECEIPT', () => {
    expect(resolvePublicArtifactType('pdf')).toBe(ARTIFACT_TYPES.PDF_RECEIPT)
  })

  test('Should return undefined for an unsupported or case-mismatched segment', () => {
    expect(resolvePublicArtifactType('PDF')).toBeUndefined()
    expect(resolvePublicArtifactType('xml')).toBeUndefined()
    expect(resolvePublicArtifactType(undefined)).toBeUndefined()
  })
})

describe('#publicArtifactTypeFor', () => {
  test('Should map JSON_SNAPSHOT back to "json"', () => {
    expect(publicArtifactTypeFor(ARTIFACT_TYPES.JSON_SNAPSHOT)).toBe('json')
  })

  test('Should map PDF_RECEIPT back to "pdf"', () => {
    expect(publicArtifactTypeFor(ARTIFACT_TYPES.PDF_RECEIPT)).toBe('pdf')
  })

  test('Should reject an unsupported persisted type', () => {
    expect(() => publicArtifactTypeFor('csv')).toThrow(TypeError)
  })

  test('Should round-trip through resolvePublicArtifactType', () => {
    for (const type of Object.values(ARTIFACT_TYPES)) {
      expect(resolvePublicArtifactType(publicArtifactTypeFor(type))).toBe(type)
    }
  })
})
