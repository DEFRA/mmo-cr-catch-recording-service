import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const PERSISTENCE_DIR = path.dirname(fileURLToPath(import.meta.url))
const CATCH_RECORDING_ROOT = path.resolve(PERSISTENCE_DIR, '..')

const FRAMEWORK_NEUTRAL_HISTORY_CONTRACT_FILES = [
  'catch-history-event.js',
  'catch-history-mapper.js'
]

const FRAMEWORK_NEUTRAL_CONCURRENCY_CONTRACT_FILES = ['expected-version.js']

const FRAMEWORK_NEUTRAL_IDEMPOTENCY_CONTRACT_FILES = [
  'idempotency-key.js',
  'idempotency-operation-scope.js',
  'idempotency-fingerprint.js'
]

const PERSISTENCE_SOURCE_FILES = [
  'catch-record-collection.js',
  'catch-record-mapper.js',
  'persistence-guards.js',
  'catch-persistence-errors.js',
  'catch-persistence.js',
  'expected-version.js',
  'catch-history-event.js',
  'catch-history-mapper.js',
  'catch-history-collection.js',
  'catch-history-errors.js',
  'catch-history-persistence.js',
  'idempotency-key.js',
  'idempotency-operation-scope.js',
  'idempotency-fingerprint.js',
  'catch-idempotency-collection.js',
  'catch-idempotency-errors.js',
  'catch-idempotency-persistence.js'
]

/** Step 09/11 Catch Record files that Step 12's idempotency adapter must never import — structural proof
 * that targeted idempotency remains a separate mechanism from optimistic concurrency and never bypasses
 * `applyAuditMetadataUpdate`'s expected-version check (Step 12 plan, decision 1). */
const CATCH_RECORD_CONCURRENCY_FILES_DISALLOWED_IN_IDEMPOTENCY = [
  'catch-persistence.js',
  'catch-record-collection.js',
  'catch-record-mapper.js',
  'expected-version.js'
]

const DISALLOWED_HISTORY_EXPORT_NAME_SUBSTRINGS = [
  'update',
  'delete',
  'remove',
  'replace',
  'upsert'
]

/**
 * Lists every non-test `.js` file under `root`, recursively, excluding `__fixtures__` directories
 * (shared test-only fixtures, not production source).
 *
 * @param {string} root
 * @returns {string[]} Absolute file paths.
 */
function listSourceFiles(root) {
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name.endsWith('.js') &&
        !entry.name.endsWith('.test.js') &&
        !entry.parentPath.includes(`${path.sep}__fixtures__`)
    )
    .map((entry) => path.join(entry.parentPath, entry.name))
}

describe('#architecture-boundary (persistence)', () => {
  test.each(PERSISTENCE_SOURCE_FILES)(
    '%s should not import Hapi, Boom, or Joi',
    (fileName) => {
      const source = readFileSync(
        new URL(`./${fileName}`, import.meta.url),
        'utf8'
      )

      expect(source).not.toMatch(/from\s+['"]@hapi\/hapi['"]/)
      expect(source).not.toMatch(/from\s+['"]@hapi\/boom['"]/)
      expect(source).not.toMatch(/from\s+['"]joi['"]/)
    }
  )

  test.each(FRAMEWORK_NEUTRAL_HISTORY_CONTRACT_FILES)(
    '%s (framework-neutral history contract) should not import the mongodb driver',
    (fileName) => {
      const source = readFileSync(
        new URL(`./${fileName}`, import.meta.url),
        'utf8'
      )

      expect(source).not.toMatch(/from\s+['"]mongodb['"]/)
    }
  )

  test.each(FRAMEWORK_NEUTRAL_CONCURRENCY_CONTRACT_FILES)(
    '%s (framework-neutral expected-version contract) should not import the mongodb driver',
    (fileName) => {
      const source = readFileSync(
        new URL(`./${fileName}`, import.meta.url),
        'utf8'
      )

      expect(source).not.toMatch(/from\s+['"]mongodb['"]/)
    }
  )

  test.each(FRAMEWORK_NEUTRAL_IDEMPOTENCY_CONTRACT_FILES)(
    '%s (framework-neutral idempotency contract) should not import the mongodb driver',
    (fileName) => {
      const source = readFileSync(
        new URL(`./${fileName}`, import.meta.url),
        'utf8'
      )

      expect(source).not.toMatch(/from\s+['"]mongodb['"]/)
    }
  )

  test('catch-idempotency-persistence.js exposes a closed, known set of functions — idempotency is targeted, not generic', async () => {
    const idempotencyPersistence =
      await import('./catch-idempotency-persistence.js')
    const exportedFunctionNames = Object.keys(idempotencyPersistence).filter(
      (name) => typeof idempotencyPersistence[name] === 'function'
    )

    expect(exportedFunctionNames.sort()).toEqual([
      'claimIdempotency',
      'completeIdempotencyClaim',
      'ensureCatchIdempotencyIndexes'
    ])
  })

  test('catch-idempotency-persistence.js remains structurally separate from Step 09/11 Catch Record mutation', () => {
    const source = readFileSync(
      new URL('./catch-idempotency-persistence.js', import.meta.url),
      'utf8'
    )

    for (const disallowedImport of CATCH_RECORD_CONCURRENCY_FILES_DISALLOWED_IN_IDEMPOTENCY) {
      expect(source).not.toMatch(
        new RegExp(
          `from\\s+['"]\\./${disallowedImport.replace('.', '\\.')}['"]`
        )
      )
    }
  })

  test('catch-persistence.js exposes a closed, known set of functions — no second, competing update primitive', async () => {
    const catchPersistence = await import('./catch-persistence.js')
    const exportedFunctionNames = Object.keys(catchPersistence).filter(
      (name) => typeof catchPersistence[name] === 'function'
    )

    expect(exportedFunctionNames.sort()).toEqual([
      'applyAuditMetadataUpdate',
      'applyCompleteReplacement',
      'applyCompletion',
      'applyEditStart',
      'applySectionUpdate',
      'applySubmission',
      'createCatchRecord',
      'deleteEligibleDraftForOwner',
      'ensureCatchRecordIndexes',
      'findCatchRecordById',
      'findCatchRecordByIdForOwner',
      'findCatchRecordByReference',
      'listCatchRecordsByOwner',
      'validateExpectedVersion'
    ])
  })

  test('catch-history-persistence.js exposes no update/delete/replace capability', async () => {
    const historyPersistence = await import('./catch-history-persistence.js')
    const exportedNames = Object.keys(historyPersistence)

    expect(exportedNames.length).toBeGreaterThan(0)

    for (const exportedName of exportedNames) {
      const lowerCaseName = exportedName.toLowerCase()
      for (const disallowedSubstring of DISALLOWED_HISTORY_EXPORT_NAME_SUBSTRINGS) {
        expect(lowerCaseName).not.toContain(disallowedSubstring)
      }
    }

    // Only an append operation and a query operation are exposed as callable functions - no mutation
    // or removal primitive exists to expose in the first place.
    const exportedFunctionNames = exportedNames.filter(
      (name) => typeof historyPersistence[name] === 'function'
    )
    expect(exportedFunctionNames.sort()).toEqual([
      'appendCatchHistoryEvent',
      'ensureCatchHistoryIndexes',
      'listCatchHistoryEventsForOwner'
    ])
  })

  test('CatchPersistence is the only Catch Recording owner of the mongodb driver', () => {
    const otherSourceFiles = listSourceFiles(CATCH_RECORDING_ROOT).filter(
      (filePath) => !filePath.startsWith(PERSISTENCE_DIR + path.sep)
    )

    expect(otherSourceFiles.length).toBeGreaterThan(0)

    for (const filePath of otherSourceFiles) {
      const source = readFileSync(filePath, 'utf8')
      expect(source).not.toMatch(/from\s+['"]mongodb['"]/)
    }
  })
})
