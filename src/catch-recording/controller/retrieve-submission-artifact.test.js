import { retrieveSubmissionArtifact } from './retrieve-submission-artifact.js'
import { isApplicationError } from '#/common/helpers/errors/application-error.js'

const OWNER_USER_ID = 'owner-1'
const CATCH_RECORD_ID = 'record-1'

function buildFakeDb(catchRecordDocument) {
  return {
    collection: vi.fn(() => ({
      findOne: vi.fn(async (filter) => {
        if (!catchRecordDocument) {
          return null
        }
        const matches = Object.entries(filter).every(
          ([key, value]) => catchRecordDocument[key] === value
        )
        return matches ? catchRecordDocument : null
      })
    }))
  }
}

function baseDocument(overrides = {}) {
  return {
    _id: CATCH_RECORD_ID,
    schemaVersion: 1,
    catchRecordReference: 'GBR-RSS123456-051026-113500',
    ownerUserId: OWNER_USER_ID,
    status: 'SUBMITTED',
    numberOfSubmissions: 1,
    gears: [],
    artifacts: [
      { submissionNumber: 1, type: 'JSON_SNAPSHOT' },
      { submissionNumber: 1, type: 'PDF_RECEIPT' }
    ],
    ...overrides
  }
}

function authenticationContext(userId = OWNER_USER_ID) {
  return Object.freeze({ userId, scopes: Object.freeze([]) })
}

function fakeCatchArtifactStore(body = Buffer.from('{}')) {
  return {
    retrieveArtifact: vi.fn(async () => ({
      body,
      contentType: 'application/json; charset=utf-8',
      contentLength: body.length,
      checksum: 'checksum'
    }))
  }
}

describe('#retrieveSubmissionArtifact', () => {
  test('Should retrieve the committed JSON snapshot with a safe deterministic filename', async () => {
    const db = buildFakeDb(baseDocument())
    const catchArtifactStore = fakeCatchArtifactStore(Buffer.from('{"a":1}'))

    const result = await retrieveSubmissionArtifact({
      db,
      catchArtifactStore,
      authenticationContext: authenticationContext(),
      catchRecordId: CATCH_RECORD_ID,
      submissionNumber: 1,
      artifactType: 'json'
    })

    expect(result.body.toString('utf8')).toBe('{"a":1}')
    expect(result.contentType).toBe('application/json; charset=utf-8')
    expect(result.filename).toBe(
      'GBR-RSS123456-051026-113500-submission-1.json'
    )
  })

  test('Should retrieve the committed PDF receipt', async () => {
    const db = buildFakeDb(baseDocument())
    const catchArtifactStore = fakeCatchArtifactStore(Buffer.from('%PDF'))

    const result = await retrieveSubmissionArtifact({
      db,
      catchArtifactStore,
      authenticationContext: authenticationContext(),
      catchRecordId: CATCH_RECORD_ID,
      submissionNumber: 1,
      artifactType: 'pdf'
    })

    expect(result.contentType).toBe('application/pdf')
    expect(result.filename).toBe('GBR-RSS123456-051026-113500-submission-1.pdf')
  })

  test('Should reject an unsupported artifact type', async () => {
    const db = buildFakeDb(baseDocument())
    const catchArtifactStore = fakeCatchArtifactStore()

    await expect(
      retrieveSubmissionArtifact({
        db,
        catchArtifactStore,
        authenticationContext: authenticationContext(),
        catchRecordId: CATCH_RECORD_ID,
        submissionNumber: 1,
        artifactType: 'xml'
      })
    ).rejects.toMatchObject({
      category: 'INVALID_REQUEST',
      code: 'UNSUPPORTED_ARTIFACT_TYPE'
    })
    expect(catchArtifactStore.retrieveArtifact).not.toHaveBeenCalled()
  })

  test('Should reject a missing catch record', async () => {
    const db = buildFakeDb(null)
    const catchArtifactStore = fakeCatchArtifactStore()

    await expect(
      retrieveSubmissionArtifact({
        db,
        catchArtifactStore,
        authenticationContext: authenticationContext(),
        catchRecordId: CATCH_RECORD_ID,
        submissionNumber: 1,
        artifactType: 'json'
      })
    ).rejects.toMatchObject({ category: 'RESOURCE_NOT_FOUND' })
  })

  test('Should reject a horizontal access attempt by a different owner as not found', async () => {
    const db = buildFakeDb(baseDocument())
    const catchArtifactStore = fakeCatchArtifactStore()

    await expect(
      retrieveSubmissionArtifact({
        db,
        catchArtifactStore,
        authenticationContext: authenticationContext('different-owner'),
        catchRecordId: CATCH_RECORD_ID,
        submissionNumber: 1,
        artifactType: 'json'
      })
    ).rejects.toSatisfy(isApplicationError)
  })

  test('Should reject a submission number that was never committed, without calling object storage', async () => {
    const db = buildFakeDb(baseDocument())
    const catchArtifactStore = fakeCatchArtifactStore()

    await expect(
      retrieveSubmissionArtifact({
        db,
        catchArtifactStore,
        authenticationContext: authenticationContext(),
        catchRecordId: CATCH_RECORD_ID,
        submissionNumber: 99,
        artifactType: 'json'
      })
    ).rejects.toMatchObject({
      category: 'RESOURCE_NOT_FOUND',
      code: 'CATCH_ARTIFACT_NOT_FOUND'
    })
    expect(catchArtifactStore.retrieveArtifact).not.toHaveBeenCalled()
  })

  test('Should reject an uncommitted artifact type for an existing submission number, without calling object storage', async () => {
    const db = buildFakeDb(
      baseDocument({
        artifacts: [{ submissionNumber: 1, type: 'JSON_SNAPSHOT' }]
      })
    )
    const catchArtifactStore = fakeCatchArtifactStore()

    await expect(
      retrieveSubmissionArtifact({
        db,
        catchArtifactStore,
        authenticationContext: authenticationContext(),
        catchRecordId: CATCH_RECORD_ID,
        submissionNumber: 1,
        artifactType: 'pdf'
      })
    ).rejects.toMatchObject({ code: 'CATCH_ARTIFACT_NOT_FOUND' })
    expect(catchArtifactStore.retrieveArtifact).not.toHaveBeenCalled()
  })

  test('Should build a safe filename even if the reference contained unsafe characters (defence in depth)', async () => {
    const db = buildFakeDb(
      baseDocument({ catchRecordReference: 'GBR\r\n/../etc-RSS1' })
    )
    const catchArtifactStore = fakeCatchArtifactStore()

    const result = await retrieveSubmissionArtifact({
      db,
      catchArtifactStore,
      authenticationContext: authenticationContext(),
      catchRecordId: CATCH_RECORD_ID,
      submissionNumber: 1,
      artifactType: 'json'
    })

    expect(result.filename).toMatch(/^[A-Za-z0-9-]+\.json$/)
  })
})
