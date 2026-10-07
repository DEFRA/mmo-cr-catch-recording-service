import PDFDocument from 'pdfkit'

/**
 * `PDFGenerator`: produces the version-specific submission receipt from an immutable canonical
 * snapshot only. Never loads mutable database state, never calls the Reference Data Service, never
 * fetches remote content, and never mutates its input.
 *
 * Accessibility: the document declares a language (`lang`) and descriptive `info.Title`/`info.Subject`
 * metadata, uses native vector text throughout (never a rasterised/image-only page, so the receipt
 * remains selectable and searchable), and renders every section in one fixed, logical top-to-bottom
 * reading order. Full tagged-PDF/PDF-UA conformance (an explicit structure tree) is **not** implemented
 * or claimed - no approved accessibility conformance target exists anywhere in the repository, and
 * claiming one without actually building a structure tree would be worse than not claiming it. This is
 * documented as a known limitation, not an oversight (`docs/configuration-decisions.md`).
 */

const PAGE_MARGIN = 50
const HEADING_FONT_SIZE = 18
const SECTION_FONT_SIZE = 13
const BODY_FONT_SIZE = 10

function collectPdfBuffer(doc) {
  return new Promise((resolve, reject) => {
    const chunks = []
    doc.on('data', (chunk) => chunks.push(chunk))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
  })
}

function formatValue(value) {
  if (value === null || value === undefined || value === '') {
    return 'Not provided'
  }
  return String(value)
}

function writeHeading(doc, text) {
  doc.moveDown(0.5)
  doc.fontSize(SECTION_FONT_SIZE).text(text, { underline: true })
  doc.fontSize(BODY_FONT_SIZE)
}

function writeField(doc, label, value) {
  doc.text(`${label}: ${formatValue(value)}`)
}

function writeCharacteristic(doc, characteristic) {
  const unit = characteristic?.unitSnapshot
    ? ` ${characteristic.unitSnapshot}`
    : ''
  doc.text(
    `  - ${formatValue(characteristic?.nameSnapshot)}: ${formatValue(
      characteristic?.value
    )}${unit}`
  )
}

function writeSpeciesEntry(doc, speciesEntry) {
  doc.text(
    `  - ${formatValue(speciesEntry?.faoCodeSnapshot)} ${formatValue(
      speciesEntry?.nameSnapshot
    )} | above min: ${formatValue(
      speciesEntry?.weightAboveMinimumKg
    )}kg, below min: ${formatValue(
      speciesEntry?.weightBelowMinimumKg
    )}kg, discarded: ${formatValue(speciesEntry?.weightLegallyDiscardedKg)}kg`
  )
}

function writeGear(doc, gearAssociation, maxRenderedItems) {
  doc.moveDown(0.25)
  doc.text(
    `Gear: ${formatValue(gearAssociation?.gear?.codeSnapshot)} - ${formatValue(
      gearAssociation?.gear?.nameSnapshot
    )}`
  )

  const characteristics = Array.isArray(gearAssociation?.characteristics)
    ? gearAssociation.characteristics.slice(0, maxRenderedItems)
    : []
  characteristics.forEach((characteristic) =>
    writeCharacteristic(doc, characteristic)
  )

  if (gearAssociation?.statisticalArea) {
    doc.text(
      `  Statistical area: ${formatValue(
        gearAssociation.statisticalArea.codeSnapshot
      )} - ${formatValue(gearAssociation.statisticalArea.nameSnapshot)}`
    )
  }

  const speciesCaught = Array.isArray(gearAssociation?.speciesCaught)
    ? gearAssociation.speciesCaught.slice(0, maxRenderedItems)
    : []
  if (speciesCaught.length > 0) {
    doc.text('  Species caught:')
    speciesCaught.forEach((speciesEntry) =>
      writeSpeciesEntry(doc, speciesEntry)
    )
  }
}

/**
 * Generates the PDF receipt for one immutable submission snapshot.
 *
 * @param {object} snapshot the exact immutable canonical Catch Record snapshot also stored as the JSON
 *   artifact for this submission number
 * @param {{ maxRenderedItems?: number }} [options] a pragmatic rendering-safety bound (approved Step 33
 *   decision - `config.get('catchArtifacts.maxPdfRenderedItems')`), never a business completeness rule
 * @returns {Promise<{ body: Buffer, contentType: string }>}
 */
export async function generateSubmissionReceiptPdf(
  snapshot,
  { maxRenderedItems = 200 } = {}
) {
  const doc = new PDFDocument({
    size: 'A4',
    margin: PAGE_MARGIN,
    lang: 'en-GB',
    info: {
      Title: `Catch record receipt ${formatValue(snapshot?.catchRecordReference)}`,
      Subject: 'Catch Recording Service submission receipt',
      Author: 'MMO Catch Recording Service'
    }
  })

  const bufferPromise = collectPdfBuffer(doc)

  doc.fontSize(HEADING_FONT_SIZE).text('Catch Record Submission Receipt')
  doc.fontSize(BODY_FONT_SIZE)

  writeHeading(doc, 'Submission')
  writeField(doc, 'Catch record reference', snapshot?.catchRecordReference)
  writeField(doc, 'Submission number', snapshot?.numberOfSubmissions)
  writeField(doc, 'Status', snapshot?.status)
  writeField(doc, 'Submitted at', snapshot?.submittedAt)
  writeField(doc, 'Submitted by', snapshot?.submittedBy)
  writeField(doc, 'Schema version', snapshot?.schemaVersion)

  writeHeading(doc, 'Vessel')
  writeField(doc, 'Name', snapshot?.vessel?.nameSnapshot)
  writeField(doc, 'RSS', snapshot?.vessel?.rssSnapshot)
  writeField(doc, 'External mark', snapshot?.vessel?.externalMarkSnapshot)
  writeField(
    doc,
    'Length overall (m)',
    snapshot?.vessel?.lengthOverallMetresSnapshot
  )

  writeHeading(doc, 'Trip')
  writeField(doc, 'Date started', snapshot?.trip?.dateStarted)
  writeField(doc, 'Date ended', snapshot?.trip?.dateEnded)
  writeField(doc, 'Departure port', snapshot?.trip?.departurePort?.nameSnapshot)
  writeField(doc, 'Return port', snapshot?.trip?.returnPort?.nameSnapshot)

  writeHeading(doc, 'Pair fishing')
  writeField(doc, 'Enabled', snapshot?.pairFishing?.enabled)
  if (snapshot?.pairFishing?.enabled) {
    writeField(doc, 'Pair vessel', snapshot?.pairFishing?.pairVessel)
    writeField(doc, 'Pair skipper', snapshot?.pairFishing?.pairSkipperName)
  }

  writeHeading(doc, 'Gears')
  const gears = Array.isArray(snapshot?.gears)
    ? snapshot.gears.slice(0, maxRenderedItems)
    : []
  gears.forEach((gearAssociation) =>
    writeGear(doc, gearAssociation, maxRenderedItems)
  )

  const speciesNotLanded = Array.isArray(snapshot?.speciesNotLanded)
    ? snapshot.speciesNotLanded.slice(0, maxRenderedItems)
    : []
  if (speciesNotLanded.length > 0) {
    writeHeading(doc, 'Species not landed')
    speciesNotLanded.forEach((speciesEntry) =>
      writeSpeciesEntry(doc, speciesEntry)
    )
  }

  doc.end()

  const body = await bufferPromise
  return { body, contentType: 'application/pdf' }
}
