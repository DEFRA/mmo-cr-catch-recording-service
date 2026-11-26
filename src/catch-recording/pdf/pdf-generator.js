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
const HEADING_FONT_SIZE = 22
const SECTION_FONT_SIZE = 13
const BODY_FONT_SIZE = 10
const TABLE_FONT_SIZE = 8
const RULE_COLOUR = '#000000'
const TITLE_RULE_COLOUR = '#4f81bd'
const FIELD_COLUMN_WIDTHS = [125, 160, 110, 100]
const CATCH_COLUMN_WIDTHS = [0.07, 0.24, 0.17, 0.2, 0.2, 0.12]
const CATCH_COLUMNS = [
  'Area',
  'Gear',
  'Species',
  'Weight above minimum size',
  'Weight below minimum size',
  'Retained weight'
]

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

function formatDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value ?? ''))
  return match ? `${match[3]}/${match[2]}/${match[1]}` : formatValue(value)
}

function formatDateTime(value) {
  const parsed = value ? new Date(value) : null
  if (!parsed || Number.isNaN(parsed.getTime())) {
    return formatValue(value)
  }
  const pad = (n) => String(n).padStart(2, '0')
  return `${pad(parsed.getUTCDate())}/${pad(parsed.getUTCMonth() + 1)}/${parsed.getUTCFullYear()} ${pad(parsed.getUTCHours())}:${pad(parsed.getUTCMinutes())}`
}

function formatWeight(value, unit = '') {
  return value === null || value === undefined
    ? 'Not provided'
    : `${value}${unit}`
}

const SMALL_VESSEL_MAX_LENGTH_METRES = 10

/** Vessel category is derived from the snapshotted overall length (the vessels service has no category). */
export function deriveVesselCategory(vessel) {
  const length = vessel?.lengthOverallMetresSnapshot
  if (typeof length !== 'number' || !Number.isFinite(length)) {
    return null
  }
  return length < SMALL_VESSEL_MAX_LENGTH_METRES ? 'Under 10m' : '10m and over'
}

function writeRule(doc, colour = RULE_COLOUR) {
  const y = doc.y
  doc
    .moveTo(PAGE_MARGIN, y)
    .lineTo(doc.page.width - PAGE_MARGIN, y)
    .lineWidth(0.75)
    .strokeColor(colour)
    .stroke()
  doc.strokeColor(RULE_COLOUR)
  doc.x = PAGE_MARGIN
  doc.y = y + 4
}

function writeHeading(doc, text, { separator = false } = {}) {
  if (separator) {
    doc.moveDown(1.2)
    writeRule(doc)
    doc.moveDown(0.3)
  } else {
    doc.moveDown(0.8)
  }
  doc.font('Helvetica-Bold').fontSize(SECTION_FONT_SIZE).text(text)
  doc.y += 1
  writeRule(doc)
  doc.font('Helvetica').fontSize(BODY_FONT_SIZE)
}

/** Writes label/value pairs two to a row, as laid out in the approved certificate mock. */
function writeFieldRows(doc, rows) {
  rows.forEach((pairs) => {
    const cells = pairs.flatMap(([label, value], i) => [
      { text: `${label}:`, bold: true, column: i * 2 },
      { text: formatValue(value), bold: false, column: i * 2 + 1 }
    ])
    const measured = cells.map((cell) => {
      doc
        .font(cell.bold ? 'Helvetica-Bold' : 'Helvetica')
        .fontSize(BODY_FONT_SIZE)
      return doc.heightOfString(cell.text, {
        width: FIELD_COLUMN_WIDTHS[cell.column]
      })
    })
    const top = doc.y + 3
    const height = Math.max(...measured)
    if (top + height > doc.page.height - PAGE_MARGIN) {
      doc.addPage()
      doc.y = PAGE_MARGIN - 3
    }
    const rowTop = doc.y + 3
    cells.forEach((cell) => {
      const x =
        PAGE_MARGIN +
        4 +
        FIELD_COLUMN_WIDTHS.slice(0, cell.column).reduce((a, b) => a + b, 0)
      doc
        .font(cell.bold ? 'Helvetica-Bold' : 'Helvetica')
        .text(cell.text, x, rowTop, { width: FIELD_COLUMN_WIDTHS[cell.column] })
    })
    doc.x = PAGE_MARGIN
    doc.y = rowTop + height
  })
  doc.font('Helvetica')
}

function findCharacteristic(gearAssociation, pattern) {
  const found = (gearAssociation?.characteristics ?? []).find((c) =>
    pattern.test(String(c?.nameSnapshot ?? ''))
  )
  if (!found) {
    return null
  }
  return found.unitSnapshot
    ? `${found.value}${found.unitSnapshot}`
    : found.value
}

function describeGear(gearAssociation) {
  const gear = gearAssociation?.gear
  const lines = [
    `${formatValue(gear?.codeSnapshot)} - ${formatValue(gear?.nameSnapshot)}`
  ]
  const details = [
    ['Mesh size', findCharacteristic(gearAssociation, /mesh size/i)],
    ['No. of dredges', findCharacteristic(gearAssociation, /dredge/i)],
    ['Shot', findCharacteristic(gearAssociation, /times gear shot|shots?/i)]
  ]
    .filter(([, value]) => value !== null)
    .map(([label, value]) =>
      label === 'Shot' ? `Shot: x${value}` : `${label}: ${value}`
    )
  if (details.length > 0) {
    lines.push(details.join(', '))
  }
  return lines.join('\n')
}

function writeTableRow(doc, cells, { bold = false } = {}) {
  const tableWidth = doc.page.width - PAGE_MARGIN * 2
  const widths = CATCH_COLUMN_WIDTHS.map((ratio) => ratio * tableWidth)
  doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(TABLE_FONT_SIZE)
  const height =
    Math.max(
      ...cells.map((cell, i) =>
        doc.heightOfString(cell, { width: widths[i] - 6 })
      )
    ) + 10
  if (doc.y + height > doc.page.height - PAGE_MARGIN) {
    doc.addPage()
  }
  const top = doc.y
  let x = PAGE_MARGIN
  cells.forEach((cell, i) => {
    doc.lineWidth(0.75).rect(x, top, widths[i], height).stroke()
    doc.text(cell, x + 3, top + 5, { width: widths[i] - 6, align: 'center' })
    x += widths[i]
  })
  doc.x = PAGE_MARGIN
  doc.y = top + height
  doc.font('Helvetica').fontSize(BODY_FONT_SIZE)
}

function writeCatchTable(doc, snapshot, maxRenderedItems) {
  writeTableRow(doc, CATCH_COLUMNS, { bold: true })
  const gears = Array.isArray(snapshot?.gears)
    ? snapshot.gears.slice(0, maxRenderedItems)
    : []
  gears.forEach((gearAssociation) => {
    const area = formatValue(gearAssociation?.statisticalArea?.codeSnapshot)
    const gear = describeGear(gearAssociation)
    const species = Array.isArray(gearAssociation?.speciesCaught)
      ? gearAssociation.speciesCaught.slice(0, maxRenderedItems)
      : []
    if (species.length === 0) {
      writeTableRow(doc, [area, gear, 'Not provided', '', '', ''])
    }
    species.forEach((entry, index) => {
      writeTableRow(doc, [
        index === 0 ? area : '',
        index === 0 ? gear : '',
        `${formatValue(entry?.faoCodeSnapshot)} - ${formatValue(entry?.nameSnapshot)}`,
        formatWeight(entry?.weightAboveMinimumKg),
        formatWeight(entry?.weightBelowMinimumKg),
        formatWeight(entry?.retainedWeightKg)
      ])
    })
  })
}

function writeSpeciesNotLanded(doc, snapshot, maxRenderedItems) {
  const entries = Array.isArray(snapshot?.speciesNotLanded)
    ? snapshot.speciesNotLanded.slice(0, maxRenderedItems)
    : []
  if (entries.length === 0) {
    return
  }
  writeHeading(doc, 'Species not landed')
  entries.forEach((entry) =>
    doc.text(
      `${formatValue(entry?.faoCodeSnapshot)} - ${formatValue(entry?.nameSnapshot)} | above min: ${formatWeight(entry?.weightAboveMinimumKg, 'kg')}, below min: ${formatWeight(entry?.weightBelowMinimumKg, 'kg')}, discarded: ${formatWeight(entry?.weightLegallyDiscardedKg, 'kg')}`
    )
  )
}

function writeAmendmentDetails(doc, snapshot) {
  const submissions = Number(snapshot?.numberOfSubmissions) || 0
  const amended = submissions > 1
  writeHeading(doc, 'Amendment Details')
  const rows = [
    [
      ['Amendment Status', amended ? 'Amended record' : 'Original record'],
      ['Current Version', `Version ${Math.max(submissions, 1)}`]
    ]
  ]
  if (amended) {
    rows.push([
      ['Amended Date/Time', formatDateTime(snapshot?.submittedAt)],
      ['Amended By', snapshot?.submittedBy]
    ])
  }
  writeFieldRows(doc, rows)
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

  const category = deriveVesselCategory(snapshot?.vessel)
  doc
    .font('Times-Bold')
    .fontSize(HEADING_FONT_SIZE)
    .text(
      category ? `${category}: Record of your catch` : 'Record of your catch'
    )
  doc.y += 2
  writeRule(doc, TITLE_RULE_COLOUR)
  doc.font('Helvetica').fontSize(BODY_FONT_SIZE)

  const amended = (Number(snapshot?.numberOfSubmissions) || 0) > 1

  writeHeading(doc, 'General Details')
  writeFieldRows(doc, [
    [
      ['Trip Reference', snapshot?.catchRecordReference],
      ['Record Status', amended ? 'Amended' : 'Original']
    ],
    [
      ['PLN', snapshot?.vessel?.externalMarkSnapshot],
      ['Vessel Name', snapshot?.vessel?.nameSnapshot]
    ],
    [
      ['RSS Number', snapshot?.vessel?.rssSnapshot],
      ['Vessel Category', category]
    ]
  ])

  writeHeading(doc, 'Trip Details', { separator: true })
  const tripRows = [
    [
      ['Departure Port', snapshot?.trip?.departurePort?.nameSnapshot],
      ['Departure Date', formatDate(snapshot?.trip?.dateStarted)]
    ],
    [
      ['Return Port', snapshot?.trip?.returnPort?.nameSnapshot],
      ['Return Date', formatDate(snapshot?.trip?.dateEnded)]
    ]
  ]
  if (snapshot?.pairFishing?.enabled) {
    tripRows.push([
      ['Pair Vessel', snapshot.pairFishing.pairVessel],
      ['Pair Skipper', snapshot.pairFishing.pairSkipperName]
    ])
  }
  writeFieldRows(doc, tripRows)

  writeHeading(doc, 'Catch Details')
  writeCatchTable(doc, snapshot, maxRenderedItems)
  writeSpeciesNotLanded(doc, snapshot, maxRenderedItems)

  writeHeading(doc, 'Submission Details', { separator: true })
  writeFieldRows(doc, [
    [
      ['Submission Date/Time', formatDateTime(snapshot?.submittedAt)],
      ['Receipt Date/Time', formatDateTime(snapshot?.submittedAt)]
    ],
    [
      ['Submission Source', snapshot?.submissionSource],
      ['Submitter Name', snapshot?.submitter?.name]
    ],
    [['Submitter Address', snapshot?.submitter?.address]]
  ])

  writeAmendmentDetails(doc, snapshot)

  doc.end()

  const body = await bufferPromise
  return { body, contentType: 'application/pdf' }
}
