import { describe, expect, it } from 'vitest'
import { pdfFilename } from './filename'

// Pure filename derivation for export: the Document title becomes the PDF
// filename, sanitised of path/invalid characters so a download or Web Share
// never lands somewhere unexpected. Expected values are hand-written literals
// (the spec for the sanitisation), not derived the way the function works.

describe('pdfFilename', () => {
  it('appends .pdf to a plain title', () => {
    expect(pdfFilename('Contract')).toBe('Contract.pdf')
  })

  it('strips path separators and other invalid filename characters', () => {
    expect(pdfFilename('a/b\\c:d*e?f"g<h>i|j')).toBe('abcdefghij.pdf')
  })

  it('collapses internal whitespace and trims', () => {
    expect(pdfFilename('  Lease   2024  ')).toBe('Lease 2024.pdf')
  })

  it('falls back to a default name when the title is empty or only whitespace', () => {
    expect(pdfFilename('')).toBe('document.pdf')
    expect(pdfFilename('   ')).toBe('document.pdf')
  })

  it('falls back to a default name when only invalid characters remain', () => {
    expect(pdfFilename('///')).toBe('document.pdf')
  })

  it('strips control characters', () => {
    expect(pdfFilename('Repor\x00t\x07\x1f')).toBe('Report.pdf')
  })

  it('truncates an overlong title, keeping the .pdf extension', () => {
    const long = 'x'.repeat(500)
    const name = pdfFilename(long)
    expect(name).toMatch(/\.pdf$/)
    expect(name.length).toBeLessThan(long.length)
  })
})
