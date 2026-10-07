import { createHash } from 'node:crypto'

import {
  HeadObjectCommand,
  PutObjectCommand,
  GetObjectCommand
} from '@aws-sdk/client-s3'

import { buildS3CatchArtifactStore } from './s3-artifact-store.js'

function sha256Hex(body) {
  return createHash('sha256').update(body).digest('hex')
}

function notFoundError(name = 'NotFound') {
  const error = new Error('not found')
  error.name = name
  return error
}

function buildClient(sendImplementation) {
  return { send: vi.fn(sendImplementation) }
}

const KEY = 'catch-records/example/submissions/1/snapshot.json'
const BODY = Buffer.from(JSON.stringify({ example: true }))
const CONTENT_TYPE = 'application/json; charset=utf-8'

describe('#buildS3CatchArtifactStore commitArtifact', () => {
  test('Should write and verify a brand-new artifact', async () => {
    const client = buildClient((command) => {
      if (command instanceof HeadObjectCommand) {
        return Promise.resolve({ ContentLength: BODY.length })
      }
      if (command instanceof PutObjectCommand) {
        return Promise.resolve({})
      }
      throw new Error('unexpected command')
    })

    // First HEAD (pre-write existence check) must report "not found" before the PUT happens.
    client.send.mockImplementationOnce(() => Promise.reject(notFoundError()))

    const store = buildS3CatchArtifactStore({ client, bucketName: 'bucket' })
    const result = await store.commitArtifact({
      key: KEY,
      body: BODY,
      contentType: CONTENT_TYPE
    })

    expect(result).toEqual({
      key: KEY,
      checksum: sha256Hex(BODY),
      contentLength: BODY.length,
      contentType: CONTENT_TYPE,
      reused: false
    })
    expect(client.send).toHaveBeenCalledTimes(3) // head (miss), put, head (verify)
  })

  test('Should treat a byte-identical pre-existing object as an idempotent reuse without writing again', async () => {
    const checksum = sha256Hex(BODY)
    const client = buildClient(() =>
      Promise.resolve({
        ContentLength: BODY.length,
        Metadata: { sha256: checksum }
      })
    )

    const store = buildS3CatchArtifactStore({ client, bucketName: 'bucket' })
    const result = await store.commitArtifact({
      key: KEY,
      body: BODY,
      contentType: CONTENT_TYPE
    })

    expect(result.reused).toBe(true)
    expect(client.send).toHaveBeenCalledTimes(1) // head only - no PutObjectCommand ever sent
    expect(
      client.send.mock.calls.every(
        ([command]) => !(command instanceof PutObjectCommand)
      )
    ).toBe(true)
  })

  test('Should reject a mismatching pre-existing object as a safe integrity conflict', async () => {
    const client = buildClient(() =>
      Promise.resolve({
        ContentLength: BODY.length,
        Metadata: { sha256: 'a'.repeat(64) }
      })
    )

    const store = buildS3CatchArtifactStore({ client, bucketName: 'bucket' })

    await expect(
      store.commitArtifact({ key: KEY, body: BODY, contentType: CONTENT_TYPE })
    ).rejects.toMatchObject({ code: 'ARTIFACT_INTEGRITY_CONFLICT' })
  })

  test('Should translate a PutObjectCommand failure into a safe write-failed error', async () => {
    const client = buildClient((command) => {
      if (command instanceof HeadObjectCommand) {
        return Promise.reject(notFoundError())
      }
      return Promise.reject(new Error('network error'))
    })

    const store = buildS3CatchArtifactStore({ client, bucketName: 'bucket' })

    await expect(
      store.commitArtifact({ key: KEY, body: BODY, contentType: CONTENT_TYPE })
    ).rejects.toMatchObject({ code: 'ARTIFACT_WRITE_FAILED' })
  })

  test('Should translate a failed post-write verification into a safe verification-failed error', async () => {
    let headCallCount = 0
    const client = buildClient((command) => {
      if (command instanceof HeadObjectCommand) {
        headCallCount += 1
        return headCallCount === 1
          ? Promise.reject(notFoundError())
          : Promise.resolve({ ContentLength: BODY.length - 1 }) // wrong size on verification
      }
      if (command instanceof PutObjectCommand) {
        return Promise.resolve({})
      }
      throw new Error('unexpected command')
    })

    const store = buildS3CatchArtifactStore({ client, bucketName: 'bucket' })

    await expect(
      store.commitArtifact({ key: KEY, body: BODY, contentType: CONTENT_TYPE })
    ).rejects.toMatchObject({ code: 'ARTIFACT_VERIFICATION_FAILED' })
  })

  test('Should translate an unexpected HeadObject failure (not a 404) into a retrieval-failed error', async () => {
    const dependencyError = new Error('unavailable')
    dependencyError.$metadata = { httpStatusCode: 500 }
    const client = buildClient(() => Promise.reject(dependencyError))

    const store = buildS3CatchArtifactStore({ client, bucketName: 'bucket' })

    await expect(
      store.commitArtifact({ key: KEY, body: BODY, contentType: CONTENT_TYPE })
    ).rejects.toMatchObject({ code: 'ARTIFACT_RETRIEVAL_FAILED' })
  })
})

describe('#buildS3CatchArtifactStore retrieveArtifact', () => {
  test('Should retrieve a Buffer body and verify its checksum', async () => {
    const checksum = sha256Hex(BODY)
    const client = buildClient((command) => {
      expect(command).toBeInstanceOf(GetObjectCommand)
      return Promise.resolve({
        Body: BODY,
        ContentType: CONTENT_TYPE,
        Metadata: { sha256: checksum }
      })
    })

    const store = buildS3CatchArtifactStore({ client, bucketName: 'bucket' })
    const result = await store.retrieveArtifact(KEY)

    expect(result).toEqual({
      body: BODY,
      contentType: CONTENT_TYPE,
      contentLength: BODY.length,
      checksum
    })
  })

  test('Should retrieve a stream body exposing transformToByteArray (the real SDK shape)', async () => {
    const client = buildClient(() =>
      Promise.resolve({
        Body: {
          transformToByteArray: () => Promise.resolve(Uint8Array.from(BODY))
        },
        ContentType: CONTENT_TYPE
      })
    )

    const store = buildS3CatchArtifactStore({ client, bucketName: 'bucket' })
    const result = await store.retrieveArtifact(KEY)

    expect(result.body).toEqual(BODY)
  })

  test('Should retrieve an async-iterable stream body (Node.js Readable fallback)', async () => {
    const client = buildClient(() =>
      Promise.resolve({
        Body: {
          async *[Symbol.asyncIterator]() {
            yield BODY.subarray(0, 1)
            yield BODY.subarray(1)
          }
        },
        ContentType: CONTENT_TYPE
      })
    )

    const store = buildS3CatchArtifactStore({ client, bucketName: 'bucket' })
    const result = await store.retrieveArtifact(KEY)

    expect(result.body).toEqual(BODY)
  })

  test('Should translate a missing object into a safe not-found error', async () => {
    const client = buildClient(() => Promise.reject(notFoundError('NoSuchKey')))

    const store = buildS3CatchArtifactStore({ client, bucketName: 'bucket' })

    await expect(store.retrieveArtifact(KEY)).rejects.toMatchObject({
      code: 'CATCH_ARTIFACT_NOT_FOUND'
    })
  })

  test('Should translate any other retrieval failure into a safe retrieval-failed error', async () => {
    const client = buildClient(() => Promise.reject(new Error('network error')))

    const store = buildS3CatchArtifactStore({ client, bucketName: 'bucket' })

    await expect(store.retrieveArtifact(KEY)).rejects.toMatchObject({
      code: 'ARTIFACT_RETRIEVAL_FAILED'
    })
  })

  test('Should reject a retrieved body whose checksum no longer matches its stored metadata', async () => {
    const client = buildClient(() =>
      Promise.resolve({
        Body: BODY,
        ContentType: CONTENT_TYPE,
        Metadata: { sha256: 'b'.repeat(64) }
      })
    )

    const store = buildS3CatchArtifactStore({ client, bucketName: 'bucket' })

    await expect(store.retrieveArtifact(KEY)).rejects.toMatchObject({
      code: 'ARTIFACT_VERIFICATION_FAILED'
    })
  })
})
