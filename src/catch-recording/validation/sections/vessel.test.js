import { validateVessel } from './vessel.js'

describe('#validateVessel', () => {
  test('Should accept a vessel snapshot with a stable id', () => {
    expect(
      validateVessel({
        id: 'vessel-1',
        rssSnapshot: 'RSS123456',
        nameSnapshot: 'EXAMPLE VESSEL',
        externalMarkSnapshot: 'PH123'
      })
    ).toEqual({ valid: true, issues: [] })
  })

  test('Should reject a missing vessel', () => {
    const result = validateVessel(undefined)

    expect(result.valid).toBe(false)
    expect(result.issues).toEqual([
      {
        code: 'REQUIRED',
        path: 'vessel',
        message: 'A vessel selection is required'
      }
    ])
  })

  test('Should reject a non-object vessel', () => {
    const result = validateVessel('not-an-object')

    expect(result.valid).toBe(false)
    expect(result.issues[0].path).toBe('vessel')
  })

  test('Should reject an array vessel', () => {
    const result = validateVessel([])

    expect(result.valid).toBe(false)
    expect(result.issues[0].path).toBe('vessel')
  })

  test('Should reject a vessel with no id', () => {
    const result = validateVessel({ nameSnapshot: 'EXAMPLE VESSEL' })

    expect(result.valid).toBe(false)
    expect(result.issues).toEqual([
      {
        code: 'REQUIRED',
        path: 'vessel.id',
        message: 'A vessel id is required'
      }
    ])
  })

  test('Should reject a blank vessel id', () => {
    const result = validateVessel({ id: '   ' })

    expect(result.valid).toBe(false)
    expect(result.issues[0].path).toBe('vessel.id')
  })
})
