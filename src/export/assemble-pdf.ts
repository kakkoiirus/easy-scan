import { PDFDocument } from 'pdf-lib'
import type { Bytes } from '../types'

/** One page's worth of input to PDF assembly: the JPEG bytes and its dimensions. */
export interface PdfPageImage {
  readonly bytes: Bytes
  readonly width: number
  readonly height: number
}

/**
 * Pure assembly seam (spec M7 — the export test target). Turn an ordered list of
 * page images into a multi-page PDF: one PDF page per image, each sized to that
 * image's `width × height` so the aspect ratio is preserved and the JPEG fills
 * the page exactly.
 *
 * No DOM, no storage, no worker — the only library touched is pdf-lib (pure
 * buffer work), which is exactly what makes this unit-testable in isolation.
 * The caller materialises each page (enhanced → flat → source) and reads its
 * bytes first; this function only lays them into a PDF, in the order given.
 */
export async function assemblePdf(images: readonly PdfPageImage[]): Promise<Bytes> {
  const pdf = await PDFDocument.create()
  for (const image of images) {
    const page = pdf.addPage([image.width, image.height])
    const embedded = await pdf.embedJpg(image.bytes)
    page.drawImage(embedded, { x: 0, y: 0, width: image.width, height: image.height })
  }
  const bytes = await pdf.save()
  return bytes as Bytes
}
