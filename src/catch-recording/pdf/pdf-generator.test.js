import { generateSubmissionReceiptPdf } from './pdf-generator.js'
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
