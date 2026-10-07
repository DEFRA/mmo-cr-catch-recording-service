import { createHash } from 'node:crypto'

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand
} from '@aws-sdk/client-s3'

import {
  artifactWriteFailedError,
  artifactVerificationFailedError,
  artifactIntegrityConflictError,
  artifactNotFoundError,
  artifactRetrievalFailedError
} from './artifact-errors.js'

/**
 * The one approved S3-compatible storage adapter. The only file in this module that imports the AWS
 * SDK - `catch-artifact.js` (the framework-neutral `CatchArtifact` port) depends only on the small
 * `{ commitArtifact, retrieveArtifact }` interface this file builds, never on the SDK directly
 * (`architecture-boundary.test.js` enforces this).
 *
 * Immutability mechanism (the approved local-development substitute, documented as such -
 * `docs/configuration-decisions.md`): neither the local `floci` emulator nor every S3-compatible target
 * is guaranteed to support conditional ("create-only") writes, so a committed artifact's immutability is
 * enforced here by a pre-write existence check plus a checksum comparison - a byte-identical pre-existing
 * object is treated as an idempotent, safe no-op reuse (supporting Step 34's deterministic submission
 * recovery); a mismatching pre-existing object is rejected as a safe integrity failure. This is not a
 * substitute for true distributed-transaction safety and is not claimed as one.
 */

function sha256Hex(body) {
  return createHash('sha256').update(body).digest('hex')
}

async function streamToBuffer(body) {
  if (Buffer.isBuffer(body)) {
    return body
  }

  if (typeof body.transformToByteArray === 'function') {
    return Buffer.from(await body.transformToByteArray())
  }

  const chunks = []
  for await (const chunk of body) {
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

function isNotFoundError(error) {
  return (
    error?.name === 'NotFound' ||
    error?.name === 'NoSuchKey' ||
    error?.$metadata?.httpStatusCode === 404
  )
}

/**
 * Builds the `CatchArtifact` storage-adapter interface against a real or injected `S3Client`. Accepting
 * an already-constructed client (rather than only a factory of connection options) keeps this function
 * directly unit-testable with a stub client, and keeps `createS3CatchArtifactStore` (below) the only
 * place connection options are ever read.
 *
 * @param {{ client: import('@aws-sdk/client-s3').S3Client, bucketName: string }} input
 */
export function buildS3CatchArtifactStore({ client, bucketName }) {
  async function headObject(key) {
    try {
      return await client.send(
        new HeadObjectCommand({ Bucket: bucketName, Key: key })
      )
    } catch (error) {
      if (isNotFoundError(error)) {
        return null
      }
      throw artifactRetrievalFailedError(error)
    }
  }

  /**
   * Writes an artifact at its deterministic key, verifying the write afterwards. Never overwrites a
   * committed artifact with different content - see the module-level immutability note above.
   *
   * @param {{ key: string, body: Buffer, contentType: string }} input
   * @returns {Promise<{ key: string, checksum: string, contentLength: number, contentType: string,
   *   reused: boolean }>}
   */
  async function commitArtifact({ key, body, contentType }) {
    const checksum = sha256Hex(body)
    const existing = await headObject(key)

    if (existing) {
      const existingChecksum = existing.Metadata?.sha256
      if (existingChecksum && existingChecksum === checksum) {
        return {
          key,
          checksum,
          contentLength: body.length,
          contentType,
          reused: true
        }
      }
      throw artifactIntegrityConflictError()
    }

    try {
      await client.send(
        new PutObjectCommand({
          Bucket: bucketName,
          Key: key,
          Body: body,
          ContentType: contentType,
          Metadata: { sha256: checksum }
        })
      )
    } catch (error) {
      throw artifactWriteFailedError(error)
    }

    const verification = await headObject(key)
    if (!verification || Number(verification.ContentLength) !== body.length) {
      throw artifactVerificationFailedError()
    }

    return {
      key,
      checksum,
      contentLength: body.length,
      contentType,
      reused: false
    }
  }

  /**
   * Retrieves a committed artifact's exact stored bytes, verifying integrity against the checksum
   * recorded at write time.
   *
   * @param {string} key
   * @returns {Promise<{ body: Buffer, contentType: string, contentLength: number, checksum: string }>}
   */
  async function retrieveArtifact(key) {
    let response
    try {
      response = await client.send(
        new GetObjectCommand({ Bucket: bucketName, Key: key })
      )
    } catch (error) {
      if (isNotFoundError(error)) {
        throw artifactNotFoundError()
      }
      throw artifactRetrievalFailedError(error)
    }

    const body = await streamToBuffer(response.Body)
    const checksum = sha256Hex(body)
    const expectedChecksum = response.Metadata?.sha256

    if (expectedChecksum && expectedChecksum !== checksum) {
      throw artifactVerificationFailedError()
    }

    return {
      body,
      contentType: response.ContentType,
      contentLength: body.length,
      checksum
    }
  }

  return Object.freeze({ commitArtifact, retrieveArtifact })
}

/**
 * Builds the production `CatchArtifact` storage adapter from approved configuration. No credential is
 * ever read or constructed here - the AWS SDK's own default credential provider chain is used
 * unchanged (env vars locally, an IAM task role in deployed CDP environments).
 *
 * @param {{ bucketName: string, region: string, endpoint?: string|null, forcePathStyle?: boolean }} options
 */
export function createS3CatchArtifactStore({
  bucketName,
  region,
  endpoint,
  forcePathStyle
}) {
  const client = new S3Client({
    region,
    ...(endpoint ? { endpoint, forcePathStyle: Boolean(forcePathStyle) } : {})
  })

  return buildS3CatchArtifactStore({ client, bucketName })
}
