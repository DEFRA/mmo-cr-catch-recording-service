import { createCatchPersistencePort } from './catch-persistence-port.js'

describe('#createCatchPersistencePort', () => {
  test('Should return the expected component name', () => {
    expect(createCatchPersistencePort().name).toBe('CatchPersistence')
  })

  test('Should return a frozen result with no dependencies', () => {
    const persistence = createCatchPersistencePort()

    expect(Object.isFrozen(persistence)).toBe(true)
    expect(Object.isFrozen(persistence.dependencies)).toBe(true)
    expect(persistence.dependencies).toEqual({})
  })

  test('Should return an independent instance on every call', () => {
    expect(createCatchPersistencePort()).not.toBe(createCatchPersistencePort())
  })
})
