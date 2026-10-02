import { assertRequiredDependency } from './assert-required-dependency.js'

describe('#assertRequiredDependency', () => {
  test('Should throw when the dependency is undefined', () => {
    expect(() =>
      assertRequiredDependency('CatchSubmission', 'persistence', undefined)
    ).toThrow('CatchSubmission requires a "persistence" dependency')
  })

  test('Should throw when the dependency is null', () => {
    expect(() =>
      assertRequiredDependency('CatchQuery', 'artifact', null)
    ).toThrow('CatchQuery requires a "artifact" dependency')
  })

  test('Should not throw when the dependency is provided', () => {
    const dependency = {}

    expect(() =>
      assertRequiredDependency('CatchSubmission', 'validation', dependency)
    ).not.toThrow()
  })

  test('Should not throw for falsy but defined dependency values', () => {
    expect(() =>
      assertRequiredDependency('CatchQuery', 'flag', false)
    ).not.toThrow()
  })
})
