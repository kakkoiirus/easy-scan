import { bestPageImage } from '../page-image'
import { opfsStorage } from '../storage/opfs-storage'
import type { Page } from '../types'
import { assemblePdf, type PdfPageImage } from './assemble-pdf'
import { deliverPdf } from './deliver'
import { jpegDimensions } from './jpeg-dimensions'
import { materialisePage } from './materialise'
import { pdfFilename } from './filename'
import { readImageBytes } from './read-image'

/** Result of an export attempt: success, or a user-facing error message. */
export type ExportOutcome = { readonly ok: true } | { readonly ok: false; readonly error: string }

/**
 * Export a Document as a multi-page PDF and hand the file to the user.
 *
 * Reads the Document from OPFS, materialises any page that lacks a flat/enhanced
 * (so the PDF reflects the chosen look — color / grayscale / B&W), then builds
 * one PDF page per Document page — in order — from each page's best image
 * (enhanced → flat → source, never a blank page), and delivers the file (share
 * on mobile where available, download otherwise). Entirely client-side
 * (ADR-0001): nothing is uploaded.
 *
 * The pure assembly step is isolated from delivery (and from storage/the
 * worker): this function is the only place those impure seams meet. Export
 * readiness ("готовим страницы…") is driven by the caller off this promise.
 */
export async function exportDocument(docId: string): Promise<ExportOutcome> {
  try {
    const doc = await opfsStorage.getDocument(docId)
    if (!doc) return { ok: false, error: 'Документ не найден.' }
    if (doc.pages.length === 0) return { ok: false, error: 'В документе нет страниц.' }

    // Materialise every page that isn't export-ready yet, in document order.
    const pages: Page[] = []
    for (const page of doc.pages) {
      pages.push(await materialisePage(docId, page))
    }

    // One PDF page per materialised page, from its best image.
    const images: PdfPageImage[] = []
    for (const page of pages) {
      const pick = bestPageImage(page)
      const bytes = await readImageBytes(pick.file)
      const { width, height } =
        pick.width != null && pick.height != null
          ? { width: pick.width, height: pick.height }
          : jpegDimensions(bytes)
      images.push({ bytes, width, height })
    }

    const pdf = await assemblePdf(images)
    await deliverPdf(pdf, pdfFilename(doc.title))
    return { ok: true }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Не удалось экспортировать PDF.',
    }
  }
}
