import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { router } from '#/plugins/router.js'

import { createCatchRecordingModule } from './catch-recording-composition.js'

const EXPECTED_COMPONENT_NAMES = {
  controller: 'CatchRecordingController',
  normalization: 'CatchNormalization',
  submission: 'CatchSubmission',
  query: 'CatchQuery',
  validation: 'CatchValidation',
  persistence: 'CatchPersistence',
  artifact: 'CatchArtifact',
  pdfGenerator: 'PDFGenerator'
}

describe('#createCatchRecordingModule', () => {
  test('Should expose all eight components with their expected names', () => {
    const module = createCatchRecordingModule()

    for (const [key, expectedName] of Object.entries(
      EXPECTED_COMPONENT_NAMES
    )) {
      expect(module[key].name).toBe(expectedName)
    }
  })

  test('Should return a frozen composition result', () => {
    expect(Object.isFrozen(createCatchRecordingModule())).toBe(true)
  })

  test.each([
    'normalization',
    'validation',
    'persistence',
    'artifact',
    'pdfGenerator'
  ])(
    'Should propagate a "%s" override by reference into dependent components',
    (overriddenKey) => {
      const override = {}
      const module = createCatchRecordingModule({ [overriddenKey]: override })

      expect(module[overriddenKey]).toBe(override)

      if (overriddenKey === 'persistence' || overriddenKey === 'artifact') {
        expect(module.submission.dependencies[overriddenKey]).toBe(override)
        expect(module.query.dependencies[overriddenKey]).toBe(override)
      }

      if (overriddenKey === 'validation' || overriddenKey === 'pdfGenerator') {
        expect(module.submission.dependencies[overriddenKey]).toBe(override)
      }
    }
  )

  test('Should not mutate a supplied override object', () => {
    const override = { custom: true }
    const snapshot = { ...override }

    createCatchRecordingModule({ persistence: override })

    expect(override).toEqual(snapshot)
  })

  test('Should not share default component instances across separate calls', () => {
    const first = createCatchRecordingModule()
    const second = createCatchRecordingModule()

    expect(first.persistence).not.toBe(second.persistence)
    expect(first.submission).not.toBe(second.submission)
    expect(first.controller).not.toBe(second.controller)
  })

  test('Should allow overriding submission and query directly', () => {
    const submission = { name: 'CatchSubmission', dependencies: {} }
    const query = { name: 'CatchQuery', dependencies: {} }

    const module = createCatchRecordingModule({ submission, query })

    expect(module.submission).toBe(submission)
    expect(module.query).toBe(query)
    expect(module.controller.dependencies.submission).toBe(submission)
    expect(module.controller.dependencies.query).toBe(query)
  })
})

describe('Catch Recording boundary source files', () => {
  const directory = dirname(fileURLToPath(import.meta.url))
  const forbiddenImportTokens = [
    '@hapi/hapi',
    "from 'mongodb'",
    '@aws-sdk',
    "from 'aws4'",
    'pdfkit',
    'puppeteer',
    'pdf-lib'
  ]

  const boundarySourceFiles = readdirSync(directory).filter(
    (file) => file.endsWith('.js') && !file.endsWith('.test.js')
  )

  test('Should have discovered the expected boundary and composition files', () => {
    expect(boundarySourceFiles.length).toBeGreaterThanOrEqual(9)
  })

  test.each(boundarySourceFiles)(
    'Should not import Hapi, MongoDB, AWS SDK or a PDF library in %s',
    (file) => {
      const source = readFileSync(join(directory, file), 'utf8')

      for (const token of forbiddenImportTokens) {
        expect(source).not.toContain(token)
      }
    }
  )
})

describe('Existing route registration', () => {
  test('Should still register only the existing health and example routes', () => {
    const registeredRouteLists = []
    const fakeServer = {
      route: (routes) => registeredRouteLists.push(routes)
    }

    router.plugin.register(fakeServer, {})

    expect(registeredRouteLists).toHaveLength(1)

    const routes = registeredRouteLists[0]
    const paths = routes.map((route) => route.path)

    expect(paths).toEqual(['/health', '/example', '/example/{exampleId}'])
    expect(paths.some((path) => path.toLowerCase().includes('catch'))).toBe(
      false
    )
  })
})
