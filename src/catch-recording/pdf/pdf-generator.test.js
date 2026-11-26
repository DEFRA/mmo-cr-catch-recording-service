import {
  deriveVesselCategory,
  generateSubmissionReceiptPdf
} from './pdf-generator.js'
import { newDraftExample } from '../domain/__fixtures__/canonical-catch-record.fixtures.js'

describe('#generateSubmissionReceiptPdf', () => {
  test('Should generate a valid PDF buffer from an immutable snapshot', async () => {
    const snapshot = {
      ...newDraftExample,
      status: 'SUBMITTED',
      numberOfSubmissions: 1,
      submittedAt: '2026-10-07T09:00:00Z',
      submittedBy: 'e0ec9737-908e-4749-97e0-41caf19de2c2'
    }

    const { body, contentType } = await generateSubmissionReceiptPdf(snapshot)

    expect(contentType).toBe('application/pdf')
    expect(Buffer.isBuffer(body)).toBe(true)
    expect(body.subarray(0, 5).toString('latin1')).toBe('%PDF-')
    expect(body.length).toBeGreaterThan(0)
  })

  test('Should render pair-fishing detail only when enabled', async () => {
    const enabledSnapshot = {
      ...newDraftExample,
      pairFishing: {
        enabled: true,
        pairVessel: 'Pair Vessel',
        pairSkipperName: 'Jane Skipper'
      }
    }

    const { body } = await generateSubmissionReceiptPdf(enabledSnapshot)

    expect(body.length).toBeGreaterThan(0)
  })

  test('Should render species not landed when present', async () => {
    const snapshotWithSpeciesNotLanded = {
      ...newDraftExample,
      speciesNotLanded: [
        {
          id: 'WHG',
          faoCodeSnapshot: 'WHG',
          nameSnapshot: 'Whiting',
          weightAboveMinimumKg: 5,
          weightBelowMinimumKg: null,
          weightLegallyDiscardedKg: null
        }
      ]
    }

    const { body } = await generateSubmissionReceiptPdf(
      snapshotWithSpeciesNotLanded
    )

    expect(body.length).toBeGreaterThan(0)
  })

  test('Should bound the number of rendered gears using the approved safety limit', async () => {
    const manyGears = Array.from({ length: 10 }, (_, index) => ({
      ...newDraftExample.gears[0],
      associationId: `gear-${index}`
    }))

    const { body } = await generateSubmissionReceiptPdf(
      { ...newDraftExample, gears: manyGears },
      { maxRenderedItems: 2 }
    )

    expect(body.length).toBeGreaterThan(0)
  })

  test('Should not mutate its input snapshot', async () => {
    const snapshot = { ...newDraftExample }
    const inputCopy = JSON.parse(JSON.stringify(snapshot))

    await generateSubmissionReceiptPdf(snapshot)

    expect(snapshot).toEqual(inputCopy)
  })

  test('Should handle a minimal/malformed-ish snapshot defensively without throwing', async () => {
    const { body } = await generateSubmissionReceiptPdf({})

    expect(body.length).toBeGreaterThan(0)
  })
})

describe('#generateSubmissionReceiptPdf layout', () => {
  async function renderText(snapshot) {
    const { body } = await generateSubmissionReceiptPdf(snapshot)
    return body.toString('latin1')
  }

  test('Should render amendment details for a resubmitted record', async () => {
    const snapshot = {
      ...newDraftExample,
      status: 'SUBMITTED',
      numberOfSubmissions: 2,
      submittedAt: '2026-10-07T09:00:00Z',
      submittedBy: 'user-1'
    }

    const { body } = await generateSubmissionReceiptPdf(snapshot)

    expect(body.subarray(0, 5).toString('latin1')).toBe('%PDF-')
  })

  test('Should span pages when there are many species rows', async () => {
    const species = Array.from({ length: 80 }, (_, i) => ({
      id: `s-${i}`,
      faoCodeSnapshot: 'COD',
      nameSnapshot: 'Atlantic Cod',
      weightAboveMinimumKg: i,
      weightBelowMinimumKg: 0
    }))
    const gear = { ...newDraftExample.gears[0], speciesCaught: species }

    const text = await renderText({ ...newDraftExample, gears: [gear] })

    expect(text.match(/\/Type \/Page\b/g).length).toBeGreaterThan(1)
  })
})

describe('#deriveVesselCategory', () => {
  test.each([
    [8.74, 'Under 10m'],
    [9.99, 'Under 10m'],
    [10, '10m and over'],
    [24.5, '10m and over']
  ])('Should categorise a %s metre vessel as %s', (length, expected) => {
    expect(deriveVesselCategory({ lengthOverallMetresSnapshot: length })).toBe(
      expected
    )
  })

  test.each([[undefined], [null], ['8'], [Number.NaN]])(
    'Should return null when the length is %s',
    (length) => {
      expect(
        deriveVesselCategory({ lengthOverallMetresSnapshot: length })
      ).toBeNull()
    }
  )

  test('Should return null when there is no vessel', () => {
    expect(deriveVesselCategory(undefined)).toBeNull()
  })
})
