import {
  storeSubmissionArtifacts,
  retrieveCommittedArtifact,
  ARTIFACT_TYPES
} from './catch-artifact.js'
import { buildArtifactKey } from './artifact-keys.js'

const CATCH_RECORD_ID = '5f9c6586-3bf0-4fbb-95d8-ef2cf9c1d9af'

function buildFakeStore() {
  const committed = new Map()
  return {
    committed,
    commitArtifact: vi.fn(async ({ key, body, contentType }) => {
      committed.set(key, body)
      return {
        key,
        checksum: `checksum-of-${key}`,
        contentLength: body.length,
        contentType,
        reused: false
      }
    }),
    retrieveArtifact: vi.fn(async (key) => {
      const body = committed.get(key)
      if (!body) {
        throw new Error('not found')
      }
      return {
        body,
        contentType: 'application/octet-stream',
        contentLength: body.length,
        checksum: 'x'
      }
    })
  }
}

describe('#storeSubmissionArtifacts', () => {
  test('Should commit both the JSON snapshot and PDF receipt under the same submission number', async () => {
    const store = buildFakeStore()
    const jsonBody = Buffer.from('{}')
    const pdfBody = Buffer.from('%PDF-1.4')

    const artifacts = await storeSubmissionArtifacts(store, {
      catchRecordId: CATCH_RECORD_ID,
      submissionNumber: 1,
      jsonBody,
      pdfBody
    })

    expect(artifacts).toEqual([
      {
        submissionNumber: 1,
        type: ARTIFACT_TYPES.JSON_SNAPSHOT,
        contentType: 'application/json; charset=utf-8',
        contentLength: jsonBody.length,
        checksum: expect.any(String)
      },
      {
        submissionNumber: 1,
        type: ARTIFACT_TYPES.PDF_RECEIPT,
        contentType: 'application/pdf',
        contentLength: pdfBody.length,
        checksum: expect.any(String)
      }
    ])
    expect(store.commitArtifact).toHaveBeenCalledTimes(2)
  })

  test('Should commit the JSON snapshot before the PDF receipt (deterministic, sequential order)', async () => {
    const store = buildFakeStore()
    const callOrder = []
    store.commitArtifact.mockImplementation(
      async ({ key, body, contentType }) => {
        callOrder.push(key)
        return {
          key,
          checksum: 'x',
          contentLength: body.length,
          contentType,
          reused: false
        }
      }
    )

    await storeSubmissionArtifacts(store, {
      catchRecordId: CATCH_RECORD_ID,
      submissionNumber: 1,
      jsonBody: Buffer.from('{}'),
      pdfBody: Buffer.from('%PDF')
    })

    expect(callOrder).toEqual([
      buildArtifactKey({
        catchRecordId: CATCH_RECORD_ID,
        submissionNumber: 1,
        type: ARTIFACT_TYPES.JSON_SNAPSHOT
      }),
      buildArtifactKey({
        catchRecordId: CATCH_RECORD_ID,
        submissionNumber: 1,
        type: ARTIFACT_TYPES.PDF_RECEIPT
      })
    ])
  })

  test('Should never pass the underlying storage adapter a client-constructed key', async () => {
    const store = buildFakeStore()

    await storeSubmissionArtifacts(store, {
      catchRecordId: CATCH_RECORD_ID,
      submissionNumber: 7,
      jsonBody: Buffer.from('{}'),
      pdfBody: Buffer.from('%PDF')
    })

    const [[jsonCallArgs], [pdfCallArgs]] = store.commitArtifact.mock.calls
    expect(jsonCallArgs.key).toBe(
      buildArtifactKey({
        catchRecordId: CATCH_RECORD_ID,
        submissionNumber: 7,
        type: ARTIFACT_TYPES.JSON_SNAPSHOT
      })
    )
    expect(pdfCallArgs.key).toBe(
      buildArtifactKey({
        catchRecordId: CATCH_RECORD_ID,
        submissionNumber: 7,
        type: ARTIFACT_TYPES.PDF_RECEIPT
      })
    )
  })
})

describe('#retrieveCommittedArtifact', () => {
  test('Should retrieve a previously committed artifact by recomputing its deterministic key', async () => {
    const store = buildFakeStore()
    const jsonBody = Buffer.from('{"a":1}')
    await storeSubmissionArtifacts(store, {
      catchRecordId: CATCH_RECORD_ID,
      submissionNumber: 1,
      jsonBody,
      pdfBody: Buffer.from('%PDF')
    })

    const result = await retrieveCommittedArtifact(store, {
      catchRecordId: CATCH_RECORD_ID,
      submissionNumber: 1,
      type: ARTIFACT_TYPES.JSON_SNAPSHOT
    })

    expect(result.body).toEqual(jsonBody)
  })

  test('Should never accept a client-supplied storage key - only a catchRecordId/submissionNumber/type triple', async () => {
    const store = buildFakeStore()

    await expect(
      retrieveCommittedArtifact(store, {
        catchRecordId: CATCH_RECORD_ID,
        submissionNumber: 99,
        type: ARTIFACT_TYPES.JSON_SNAPSHOT
      })
    ).rejects.toThrow()
    expect(store.retrieveArtifact).toHaveBeenCalledWith(
      buildArtifactKey({
        catchRecordId: CATCH_RECORD_ID,
        submissionNumber: 99,
        type: ARTIFACT_TYPES.JSON_SNAPSHOT
      })
    )
  })
})
