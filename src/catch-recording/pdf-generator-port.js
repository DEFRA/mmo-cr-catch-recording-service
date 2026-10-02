// PDFGenerator port (Step 02 — Catch Recording module boundaries).
//
// Represents the future version-specific receipt-generation boundary described in
// design/design/catch-recording-service-design.md §6.7. No concrete PDF library types or generation
// methods are defined here — see the later step that selects and introduces a PDF library. This port
// intentionally exposes no methods yet; it is a stable, replaceable identity only.
export function createPdfGeneratorPort() {
  return Object.freeze({
    name: 'PDFGenerator',
    dependencies: Object.freeze({})
  })
}
