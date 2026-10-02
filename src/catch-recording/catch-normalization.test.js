import { createCatchNormalization } from './catch-normalization.js'

describe('#createCatchNormalization', () => {
  test('Should return the expected component name', () => {
    expect(createCatchNormalization().name).toBe('CatchNormalization')
  })

  test('Should return a frozen result with no dependencies', () => {
    const normalization = createCatchNormalization()

    expect(Object.isFrozen(normalization)).toBe(true)
    expect(Object.isFrozen(normalization.dependencies)).toBe(true)
    expect(normalization.dependencies).toEqual({})
  })

  test('Should return an independent instance on every call', () => {
    expect(createCatchNormalization()).not.toBe(createCatchNormalization())
  })
})
