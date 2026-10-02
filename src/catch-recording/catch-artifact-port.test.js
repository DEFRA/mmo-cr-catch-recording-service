import { createCatchArtifactPort } from './catch-artifact-port.js'

describe('#createCatchArtifactPort', () => {
  test('Should return the expected component name', () => {
    expect(createCatchArtifactPort().name).toBe('CatchArtifact')
  })

  test('Should return a frozen result with no dependencies', () => {
    const artifact = createCatchArtifactPort()

    expect(Object.isFrozen(artifact)).toBe(true)
    expect(Object.isFrozen(artifact.dependencies)).toBe(true)
    expect(artifact.dependencies).toEqual({})
  })

  test('Should return an independent instance on every call', () => {
    expect(createCatchArtifactPort()).not.toBe(createCatchArtifactPort())
  })
})
