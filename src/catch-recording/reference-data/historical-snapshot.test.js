import { preserveOrRefresh } from './historical-snapshot.js'

describe('#preserveOrRefresh', () => {
  test('Should preserve the stored snapshot unchanged when the id is unchanged', () => {
    const storedSnapshot = Object.freeze({ nameSnapshot: 'Plymouth' })

    const result = preserveOrRefresh({
      previousId: 'port-1',
      storedSnapshot,
      nextId: 'port-1'
    })

    expect(result).toEqual({
      snapshot: { nameSnapshot: 'Plymouth' },
      requiresResolution: false
    })
    expect(result.snapshot).not.toBe(storedSnapshot)
  })

  test('Should require fresh resolution when the id has changed', () => {
    const result = preserveOrRefresh({
      previousId: 'port-1',
      storedSnapshot: { nameSnapshot: 'Plymouth' },
      nextId: 'port-2'
    })

    expect(result).toEqual({ snapshot: null, requiresResolution: true })
  })

  test('Should require fresh resolution when there is no previous id', () => {
    const result = preserveOrRefresh({
      previousId: undefined,
      storedSnapshot: null,
      nextId: 'port-1'
    })

    expect(result.requiresResolution).toBe(true)
  })

  test('Should require fresh resolution when there is no stored snapshot even if the id matches', () => {
    const result = preserveOrRefresh({
      previousId: 'port-1',
      storedSnapshot: null,
      nextId: 'port-1'
    })

    expect(result.requiresResolution).toBe(true)
  })

  test('Should not mutate the stored snapshot input', () => {
    const storedSnapshot = Object.freeze({ nameSnapshot: 'Plymouth' })

    preserveOrRefresh({
      previousId: 'port-1',
      storedSnapshot,
      nextId: 'port-1'
    })

    expect(storedSnapshot).toEqual({ nameSnapshot: 'Plymouth' })
  })
})
