import { setPageEnhanced, setPageFlat } from '../storage/useDocuments'
import type { Page } from '../types'
import { cvClient } from '../worker/cv-client'
import { readImageBytes } from './read-image'

/**
 * Bring a Page up to its export-ready state — flat (perspective-corrected) AND
 * enhanced (its chosen color / grayscale / B&W look) — by running the same
 * worker passes it would otherwise get lazily on view. Idempotent: a page that
 * already has a flat/enhanced skips the corresponding step. Each result is
 * persisted through the storage port (ADR-0003), mirroring PagePane's effects,
 * so the materialised files survive and the UI re-reads them after export.
 *
 * Best-effort per step, so one bad page never blocks the whole Document: a warp
 * failure leaves the page without a flat (export then falls back to its source
 * photo), and an enhance failure leaves a flat but no enhanced (export uses the
 * flat). Returns the page carrying whatever materialised. The worker runs the
 * OpenCV passes off the main thread (ADR-0002).
 */
export async function materialisePage(docId: string, page: Page): Promise<Page> {
  let current = page

  if (!current.flat) {
    try {
      const source = await readImageBytes(current.file)
      const warped = await cvClient.warp(source, current.quad)
      if (warped.ok) {
        const flat = await setPageFlat(docId, current.id, warped.bytes, warped.width, warped.height)
        current = { ...current, flat }
      }
    } catch {
      // No flat — export falls back to the source photo for this page.
    }
  }

  if (current.flat && !current.enhanced) {
    try {
      const flatBytes = await readImageBytes(current.flat.file)
      const result = await cvClient.enhance(flatBytes, current.enhanceMode)
      if (result.ok) {
        const enhanced = await setPageEnhanced(
          docId,
          current.id,
          result.bytes,
          result.width,
          result.height,
        )
        current = { ...current, enhanced }
      }
    } catch {
      // No enhanced — export uses this page's flat image.
    }
  }

  return current
}
