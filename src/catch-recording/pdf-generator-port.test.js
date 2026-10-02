import { createPdfGeneratorPort } from './pdf-generator-port.js'

describe('#createPdfGeneratorPort', () => {
  test('Should return the expected component name', () => {
    expect(createPdfGeneratorPort().name).toBe('PDFGenerator')
  })

  test('Should return a frozen result with no dependencies', () => {
    const pdfGenerator = createPdfGeneratorPort()

    expect(Object.isFrozen(pdfGenerator)).toBe(true)
    expect(Object.isFrozen(pdfGenerator.dependencies)).toBe(true)
    expect(pdfGenerator.dependencies).toEqual({})
  })

  test('Should return an independent instance on every call', () => {
    expect(createPdfGeneratorPort()).not.toBe(createPdfGeneratorPort())
  })
})
