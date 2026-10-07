import {
  artifactWriteFailedError,
  artifactVerificationFailedError,
  artifactIntegrityConflictError,
  artifactNotFoundError,
  artifactRetrievalFailedError
} from './artifact-errors.js'

describe('#artifact-errors', () => {
  test('Should build a safe ARTIFACT_OPERATION_FAILURE for a write failure', () => {
    const error = artifactWriteFailedError(new Error('raw SDK detail'))
    expect(error.category).toBe('ARTIFACT_OPERATION_FAILURE')
    expect(error.code).toBe('ARTIFACT_WRITE_FAILED')
    expect(JSON.stringify(error)).not.toMatch(/raw SDK detail/)
  })

  test('Should build a safe ARTIFACT_OPERATION_FAILURE for a verification failure', () => {
    const error = artifactVerificationFailedError()
    expect(error.category).toBe('ARTIFACT_OPERATION_FAILURE')
    expect(error.code).toBe('ARTIFACT_VERIFICATION_FAILED')
  })

  test('Should build a safe ARTIFACT_OPERATION_FAILURE for an integrity conflict', () => {
    const error = artifactIntegrityConflictError()
    expect(error.category).toBe('ARTIFACT_OPERATION_FAILURE')
    expect(error.code).toBe('ARTIFACT_INTEGRITY_CONFLICT')
  })

  test('Should build a safe RESOURCE_NOT_FOUND for a missing artifact', () => {
    const error = artifactNotFoundError()
    expect(error.category).toBe('RESOURCE_NOT_FOUND')
    expect(error.code).toBe('CATCH_ARTIFACT_NOT_FOUND')
  })

  test('Should build a safe ARTIFACT_OPERATION_FAILURE for a retrieval failure', () => {
    const error = artifactRetrievalFailedError(new Error('raw SDK detail'))
    expect(error.category).toBe('ARTIFACT_OPERATION_FAILURE')
    expect(error.code).toBe('ARTIFACT_RETRIEVAL_FAILED')
    expect(JSON.stringify(error)).not.toMatch(/raw SDK detail/)
  })
})
