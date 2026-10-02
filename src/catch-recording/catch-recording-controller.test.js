import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { createCatchRecordingController } from './catch-recording-controller.js'

describe('#createCatchRecordingController', () => {
  const dependencies = () => ({
    submission: {},
    query: {}
  })

  test.each(['submission', 'query'])(
    'Should throw deterministically when "%s" is missing',
    (missingDependency) => {
      const deps = dependencies()
      deps[missingDependency] = undefined

      expect(() => createCatchRecordingController(deps)).toThrow(
        `CatchRecordingController requires a "${missingDependency}" dependency`
      )
    }
  )

  test('Should return the expected component name', () => {
    expect(createCatchRecordingController(dependencies()).name).toBe(
      'CatchRecordingController'
    )
  })

  test('Should return a frozen result referencing the exact supplied dependencies', () => {
    const deps = dependencies()
    const controller = createCatchRecordingController(deps)

    expect(Object.isFrozen(controller)).toBe(true)
    expect(controller.dependencies.submission).toBe(deps.submission)
    expect(controller.dependencies.query).toBe(deps.query)
  })

  test('Should not import Hapi in its source', () => {
    const sourcePath = fileURLToPath(
      new URL('./catch-recording-controller.js', import.meta.url)
    )
    const source = readFileSync(sourcePath, 'utf8')

    expect(source).not.toMatch(/@hapi\/hapi/)
  })
})
