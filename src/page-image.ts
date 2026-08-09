import type { Page } from './types'

/**
 * The OPFS file that best represents a Page for a thumbnail/preview, plus — when
 * available — its recorded pixel dimensions. Follows the same enhanced → flat →
 * source fallback as the page strip and export, so this is the single source of
 * that rule. The flat and enhanced results carry width/height; the source photo
 * does not (export reads its dimensions from the JPEG bytes in that case).
 *
 * Pure domain logic (no React, no DOM), kept out of the UI layer so the export
 * service can share the same fallback rule without depending on UI.
 */
export interface PageImagePick {
  readonly file: string
  readonly width?: number
  readonly height?: number
}

/**
 * The best image for a Page — enhanced, else flat, else source — with the
 * recorded dimensions for the flat/enhanced results. The single source of the
 * fallback rule; `bestImageFile` is a thin projection over it.
 */
export function bestPageImage(page: Page): PageImagePick {
  if (page.enhanced) {
    return { file: page.enhanced.file, width: page.enhanced.width, height: page.enhanced.height }
  }
  if (page.flat) {
    return { file: page.flat.file, width: page.flat.width, height: page.flat.height }
  }
  return { file: page.file }
}

/** The OPFS file path of a Page's best image (enhanced, else flat, else source). */
export function bestImageFile(page: Page): string {
  return bestPageImage(page).file
}
