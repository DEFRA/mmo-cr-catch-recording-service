import { createCatchSubmission } from './catch-submission.js'

describe('#createCatchSubmission', () => {
  const dependencies = () => ({
    validation: {},
    persistence: {},
    artifact: {},
    pdfGenerator: {}
  })

  test.each(['validation', 'persistence', 'artifact', 'pdfGenerator'])(
    'Should throw deterministically when "%s" is missing',
    (missingDependency) => {
      const deps = dependencies()
      deps[missingDependency] = undefined

      expect(() => createCatchSubmission(deps)).toThrow(
        `CatchSubmission requires a "${missingDependency}" dependency`
      )
    }
  )

  test('Should throw when called with no dependencies at all', () => {
    expect(() => createCatchSubmission()).toThrow(
      'CatchSubmission requires a "validation" dependency'
    )
  })

  test('Should return the expected component name', () => {
    expect(createCatchSubmission(dependencies()).name).toBe('CatchSubmission')
  })

  test('Should return a frozen result referencing the exact supplied dependencies', () => {
    const deps = dependencies()
    const submission = createCatchSubmission(deps)

    expect(Object.isFrozen(submission)).toBe(true)
    expect(Object.isFrozen(submission.dependencies)).toBe(true)
    expect(submission.dependencies.validation).toBe(deps.validation)
    expect(submission.dependencies.persistence).toBe(deps.persistence)
    expect(submission.dependencies.artifact).toBe(deps.artifact)
    expect(submission.dependencies.pdfGenerator).toBe(deps.pdfGenerator)
  })

  test('Should not mutate the supplied dependencies object', () => {
    const deps = dependencies()
    const snapshot = { ...deps }

    createCatchSubmission(deps)

    expect(deps).toEqual(snapshot)
  })
})
