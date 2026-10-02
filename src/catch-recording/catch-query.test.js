import { createCatchQuery } from './catch-query.js'
import { createCatchSubmission } from './catch-submission.js'

describe('#createCatchQuery', () => {
  const dependencies = () => ({
    persistence: {},
    artifact: {}
  })

  test.each(['persistence', 'artifact'])(
    'Should throw deterministically when "%s" is missing',
    (missingDependency) => {
      const deps = dependencies()
      deps[missingDependency] = undefined

      expect(() => createCatchQuery(deps)).toThrow(
        `CatchQuery requires a "${missingDependency}" dependency`
      )
    }
  )

  test('Should throw when called with no dependencies at all', () => {
    expect(() => createCatchQuery()).toThrow(
      'CatchQuery requires a "persistence" dependency'
    )
  })

  test('Should return the expected component name', () => {
    expect(createCatchQuery(dependencies()).name).toBe('CatchQuery')
  })

  test('Should return a frozen result referencing the exact supplied dependencies', () => {
    const deps = dependencies()
    const query = createCatchQuery(deps)

    expect(Object.isFrozen(query)).toBe(true)
    expect(Object.isFrozen(query.dependencies)).toBe(true)
    expect(query.dependencies.persistence).toBe(deps.persistence)
    expect(query.dependencies.artifact).toBe(deps.artifact)
  })

  test('Should not mutate the supplied dependencies object', () => {
    const deps = dependencies()
    const snapshot = { ...deps }

    createCatchQuery(deps)

    expect(deps).toEqual(snapshot)
  })

  test('Should remain a distinct component from CatchSubmission with no cross-dependency', () => {
    const persistence = {}
    const artifact = {}
    const query = createCatchQuery({ persistence, artifact })
    const submission = createCatchSubmission({
      validation: {},
      persistence,
      artifact,
      pdfGenerator: {}
    })

    expect(query.name).not.toBe(submission.name)
    expect(query.dependencies).not.toHaveProperty('validation')
    expect(query.dependencies).not.toHaveProperty('pdfGenerator')
    expect(submission.dependencies).not.toHaveProperty('query')
    expect(query.dependencies).not.toHaveProperty('submission')
  })
})
