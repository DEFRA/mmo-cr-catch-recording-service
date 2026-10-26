import {
  isVesselSelectable,
  isSelectable,
  isStatisticalAreaSelectable,
  isGearSelectable
} from './active-selection.js'

describe('#isVesselSelectable', () => {
  test('Should be true only for status === "active"', () => {
    expect(isVesselSelectable({ status: 'active' })).toBe(true)
    expect(isVesselSelectable({ status: 'inactive' })).toBe(false)
    expect(isVesselSelectable({ status: 'ACTIVE' })).toBe(false)
  })

  test('Should be false for missing or malformed status', () => {
    expect(isVesselSelectable({})).toBe(false)
    expect(isVesselSelectable({ status: null })).toBe(false)
    expect(isVesselSelectable({ status: true })).toBe(false)
    expect(isVesselSelectable(undefined)).toBe(false)
  })
})

describe('#isSelectable', () => {
  test('Should be true only for active === true', () => {
    expect(isSelectable({ active: true })).toBe(true)
    expect(isSelectable({ active: false })).toBe(false)
  })

  test('Should be false for missing or malformed active', () => {
    expect(isSelectable({})).toBe(false)
    expect(isSelectable({ active: 'true' })).toBe(false)
    expect(isSelectable({ active: 1 })).toBe(false)
    expect(isSelectable(undefined)).toBe(false)
  })
})

describe('#isStatisticalAreaSelectable', () => {
  test('Should always be true - no active field exists for this type', () => {
    expect(isStatisticalAreaSelectable()).toBe(true)
  })
})

describe('#isGearSelectable', () => {
  test('Should always be true - gear active-selection is no longer checked (Step 43)', () => {
    expect(isGearSelectable()).toBe(true)
    expect(isGearSelectable({ active: false })).toBe(true)
    expect(isGearSelectable(undefined)).toBe(true)
  })
})
