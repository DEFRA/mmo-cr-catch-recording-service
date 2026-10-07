import { listSubmissionArtifacts } from './list-submission-artifacts.js'
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
    artifacts: [],
    ...overrides
  }
}

function authenticationContext(userId = OWNER_USER_ID) {
  return Object.freeze({ userId, scopes: Object.freeze([]) })
}

describe('#listSubmissionArtifacts', () => {
  test('Should list a committed submission with both artifact types', async () => {
    const db = buildFakeDb(
      baseDocument({
        artifacts: [
          {
            submissionNumber: 1,
            type: 'JSON_SNAPSHOT',
            contentType: 'application/json; charset=utf-8',
            contentLength: 100,
            checksum: 'abc'
          },
          {
            submissionNumber: 1,
            type: 'PDF_RECEIPT',
            contentType: 'application/pdf',
            contentLength: 200,
            checksum: 'def'
          }
        ]
      })
    )

    const result = await listSubmissionArtifacts({
      db,
      authenticationContext: authenticationContext(),
      catchRecordId: CATCH_RECORD_ID
    })

    expect(result.count).toBe(1)
    expect(result.submissions).toEqual([
      {
        submissionNumber: 1,
        artifacts: [
          {
            type: 'json',
            contentType: 'application/json; charset=utf-8',
            contentLength: 100,
            checksum: 'abc'
          },
          {
            type: 'pdf',
            contentType: 'application/pdf',
            contentLength: 200,
            checksum: 'def'
          }
        ]
      }
    ])
  })

  test('Should order multiple submissions ascending by submission number', async () => {
    const db = buildFakeDb(
      baseDocument({
        numberOfSubmissions: 2,
        artifacts: [
          { submissionNumber: 2, type: 'JSON_SNAPSHOT' },
          { submissionNumber: 2, type: 'PDF_RECEIPT' },
          { submissionNumber: 1, type: 'JSON_SNAPSHOT' },
          { submissionNumber: 1, type: 'PDF_RECEIPT' }
        ]
      })
    )

    const result = await listSubmissionArtifacts({
      db,
      authenticationContext: authenticationContext(),
      catchRecordId: CATCH_RECORD_ID
    })

    expect(result.submissions.map((s) => s.submissionNumber)).toEqual([1, 2])
  })

  test('Should exclude an internally inconsistent partial submission group', async () => {
    const db = buildFakeDb(
      baseDocument({
        artifacts: [{ submissionNumber: 1, type: 'JSON_SNAPSHOT' }]
      })
    )

    const result = await listSubmissionArtifacts({
      db,
      authenticationContext: authenticationContext(),
      catchRecordId: CATCH_RECORD_ID
    })

    expect(result.submissions).toEqual([])
    expect(result.count).toBe(0)
  })

  test('Should return an empty list for a never-submitted draft', async () => {
    const db = buildFakeDb(
      baseDocument({ status: 'DRAFT', numberOfSubmissions: 0 })
    )

    const result = await listSubmissionArtifacts({
      db,
      authenticationContext: authenticationContext(),
      catchRecordId: CATCH_RECORD_ID
    })

    expect(result).toEqual({
      catchRecordId: CATCH_RECORD_ID,
      count: 0,
      submissions: []
    })
  })

  test('Should reject a missing catch record', async () => {
    const db = buildFakeDb(null)

    await expect(
      listSubmissionArtifacts({
        db,
        authenticationContext: authenticationContext(),
        catchRecordId: CATCH_RECORD_ID
      })
    ).rejects.toMatchObject({ category: 'RESOURCE_NOT_FOUND' })
  })

  test('Should reject a horizontal access attempt by a different owner as not found', async () => {
    const db = buildFakeDb(baseDocument())

    await expect(
      listSubmissionArtifacts({
        db,
        authenticationContext: authenticationContext('different-owner'),
        catchRecordId: CATCH_RECORD_ID
      })
    ).rejects.toSatisfy(isApplicationError)
  })

  test('Should never return object-store keys, bucket names, or artifact bodies', async () => {
    const db = buildFakeDb(
      baseDocument({
        artifacts: [
          { submissionNumber: 1, type: 'JSON_SNAPSHOT', contentType: 'x' },
          { submissionNumber: 1, type: 'PDF_RECEIPT', contentType: 'y' }
        ]
      })
    )

    const result = await listSubmissionArtifacts({
      db,
      authenticationContext: authenticationContext(),
      catchRecordId: CATCH_RECORD_ID
    })

    const serialised = JSON.stringify(result)
    expect(serialised).not.toMatch(/key|bucket|body|endpoint/i)
  })
})
