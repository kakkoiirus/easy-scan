// Domain model for easy-scan. See CONTEXT.md for the ubiquitous language.
// Everything is `readonly` — produce new objects on change, never mutate (FP style).

/** Page-image bytes backed by a real ArrayBuffer (never SharedArrayBuffer). */
export type Bytes = Uint8Array<ArrayBuffer>

/** Enhancement "look" applied to a page. Trio chosen in the design phase. */
export type EnhanceMode = 'color' | 'grayscale' | 'bw'

/** A point in source-image pixel coordinates. */
export interface Point {
  readonly x: number
  readonly y: number
}

/**
 * The flattened (perspective-corrected, cropped) result of warping a Page's
 * source photo by its Quad into a clean rectangle. Stored on the Page so later
 * milestones (enhance, export) work on the flat page without rescanning.
 */
export interface FlatImage {
  /** OPFS path to the flattened JPEG, e.g. "documents/<docId>/<pageId>.flat.jpg". */
  readonly file: string
  readonly width: number
  readonly height: number
}

/**
 * Quad — the four corners that mark a page's boundary on the source photo,
 * ordered top-left, top-right, bottom-right, bottom-left.
 * Used for perspective correction ("flattening"). Avoid: polygon, outline.
 */
export type Quad = readonly [Point, Point, Point, Point]

/** A single captured sheet within a Document. */
export interface Page {
  readonly id: string
  /** OPFS path to the source JPEG, e.g. "documents/<docId>/<pageId>.jpg". */
  readonly file: string
  /** Detected/adjusted boundary on the source photo. */
  readonly quad: Quad
  /** Flattened (perspective-corrected, cropped) result. Absent until first warp. */
  readonly flat?: FlatImage
  readonly enhanceMode: EnhanceMode
  /** OCR text — populated in V2 (Tesseract.js). Absent in MVP. */
  readonly text?: string
}

/** A multi-page scan — the unit a person thinks of as "the scan". */
export interface Document {
  readonly id: string
  readonly title: string
  readonly createdAt: number
  readonly pages: readonly Page[]
}

/** Lightweight projection of a Document for list views (no page bodies). */
export interface DocumentSummary {
  readonly id: string
  readonly title: string
  readonly createdAt: number
  readonly pageCount: number
}
