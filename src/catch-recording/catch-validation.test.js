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
})
