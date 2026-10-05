import { readFileSync } from 'node:fs'

import { deriveDisplayStatus } from './display-status.js'

describe('#deriveDisplayStatus', () => {
  test('Should derive Draft for a never-submitted DRAFT', () => {
    expect(
      deriveDisplayStatus({ status: 'DRAFT', numberOfSubmissions: 0 })
    ).toBe('Draft')
  })

  test('Should derive Amended for a previously submitted DRAFT', () => {
    expect(
      deriveDisplayStatus({ status: 'DRAFT', numberOfSubmissions: 1 })
    ).toBe('Amended')
    expect(
      deriveDisplayStatus({ status: 'DRAFT', numberOfSubmissions: 5 })
    ).toBe('Amended')
  })

  test('Should derive Submitted for SUBMITTED regardless of hasUnsubmittedChanges', () => {
    expect(
      deriveDisplayStatus({ status: 'SUBMITTED', numberOfSubmissions: 1 })
    ).toBe('Submitted')
    expect(
      deriveDisplayStatus({
        status: 'SUBMITTED',
        numberOfSubmissions: 1,
        hasUnsubmittedChanges: true
      })
    ).toBe('Submitted')
  })

  test('Should derive Complete for COMPLETE', () => {
    expect(
      deriveDisplayStatus({ status: 'COMPLETE', numberOfSubmissions: 1 })
    ).toBe('Complete')
  })

  test('Should not produce a fallback display status for an unsupported persisted status', () => {
    expect(
      deriveDisplayStatus({ status: 'DRAFT_EDIT', numberOfSubmissions: 0 })
    ).toBeUndefined()
    expect(
      deriveDisplayStatus({ status: 'AMENDED', numberOfSubmissions: 1 })
    ).toBeUndefined()
    expect(
      deriveDisplayStatus({ status: 'ABANDONED', numberOfSubmissions: 0 })
    ).toBeUndefined()
    expect(
      deriveDisplayStatus({ status: 'WITHDRAWN', numberOfSubmissions: 0 })
    ).toBeUndefined()
    expect(
      deriveDisplayStatus({ status: 'NOT_A_STATUS', numberOfSubmissions: 0 })
    ).toBeUndefined()
  })

  test('Should return undefined for an invalid numberOfSubmissions on a DRAFT', () => {
    expect(
      deriveDisplayStatus({ status: 'DRAFT', numberOfSubmissions: -1 })
    ).toBeUndefined()
    expect(
      deriveDisplayStatus({ status: 'DRAFT', numberOfSubmissions: 1.5 })
    ).toBeUndefined()
    expect(
      deriveDisplayStatus({ status: 'DRAFT', numberOfSubmissions: '1' })
    ).toBeUndefined()
    expect(deriveDisplayStatus({ status: 'DRAFT' })).toBeUndefined()
  })

  test('Should return undefined for a malformed or missing catchRecord', () => {
    expect(deriveDisplayStatus(undefined)).toBeUndefined()
    expect(deriveDisplayStatus(null)).toBeUndefined()
    expect(deriveDisplayStatus('not-an-object')).toBeUndefined()
    expect(deriveDisplayStatus({})).toBeUndefined()
  })

  test('Should not trust an inherited status property', () => {
    const catchRecord = Object.create({ status: 'SUBMITTED' })
    catchRecord.numberOfSubmissions = 1

    expect(deriveDisplayStatus(catchRecord)).toBeUndefined()
  })

  test('Should not mutate its input', () => {
    const input = Object.freeze({ status: 'DRAFT', numberOfSubmissions: 1 })

    expect(() => deriveDisplayStatus(input)).not.toThrow()
    expect(input).toEqual({ status: 'DRAFT', numberOfSubmissions: 1 })
  })

  test('Should be deterministic', () => {
    const input = { status: 'DRAFT', numberOfSubmissions: 1 }

    expect(deriveDisplayStatus(input)).toBe(deriveDisplayStatus(input))
  })

  test('Should not import Hapi, Boom, Joi, or MongoDB', () => {
    const source = readFileSync(
      new URL('./display-status.js', import.meta.url),
      'utf8'
    )

    expect(source).not.toMatch(/from\s+['"]@hapi\/hapi['"]/)
    expect(source).not.toMatch(/from\s+['"]@hapi\/boom['"]/)
    expect(source).not.toMatch(/from\s+['"]joi['"]/)
    expect(source).not.toMatch(/from\s+['"]mongodb['"]/)
  })
})
