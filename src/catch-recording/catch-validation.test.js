import { createDraftCatchRecordFixture } from './canonical-catch-record-fixtures.js'
import { createCatchValidation } from './catch-validation.js'

describe('#createCatchValidation', () => {
  test('Should return the expected component name', () => {
    expect(createCatchValidation().name).toBe('CatchValidation')
  })

  test('Should return a frozen result with no dependencies', () => {
    const validation = createCatchValidation()

    expect(Object.isFrozen(validation)).toBe(true)
    expect(Object.isFrozen(validation.dependencies)).toBe(true)
    expect(validation.dependencies).toEqual({})
  })

  test('Should return an independent instance on every call', () => {
    expect(createCatchValidation()).not.toBe(createCatchValidation())
  })

  test('Should expose the approved Step 07 entry points', () => {
    const validation = createCatchValidation()

    expect(typeof validation.validateSection).toBe('function')
    expect(typeof validation.validateCompleteStructure).toBe('function')
  })
})

describe('#validateSection', () => {
  test('Should validate an approved section', () => {
    const result = createCatchValidation().validateSection('vessel', {
      id: 'vessel-1'
    })

    expect(result.isValid).toBe(true)
  })

  test('Should return a deterministic result for an unsupported section (never throw)', () => {
    const result = createCatchValidation().validateSection('skipper', {})

    expect(result.isValid).toBe(false)
  })
})

describe('#validateCompleteStructure', () => {
  test('Should validate a representative incomplete draft without requiring unrelated sections', () => {
    const draft = {
      vessel: null,
      trip: null,
      pairFishing: null,
      gear: [],
      retainedCatch: null
    }

    expect(
      createCatchValidation().validateCompleteStructure(draft).isValid
    ).toBe(true)
  })

  test('Should aggregate failures across every client-managed section', () => {
    const result = createCatchValidation().validateCompleteStructure({
      vessel: { id: 42 },
      trip: { startedAndFinishedToday: 'not-a-boolean' },
      pairFishing: null,
      gear: [],
      retainedCatch: { answer: 'MAYBE', species: [] }
    })

    expect(result.isValid).toBe(false)
    expect(result.errors.length).toBeGreaterThanOrEqual(3)
  })

  test('Should validate against the Step 05 draft fixture without requiring submission readiness', () => {
    const fixture = createDraftCatchRecordFixture()

    const result = createCatchValidation().validateCompleteStructure(fixture)

    expect(result.isValid).toBe(true)
  })

  test('Should not mutate the input', () => {
    const input = { vessel: { id: 'vessel-1' }, gear: [] }
    const snapshot = JSON.parse(JSON.stringify(input))

    createCatchValidation().validateCompleteStructure(input)

    expect(input).toEqual(snapshot)
  })
})
