import type { Bytes } from '../types'

// Start-of-frame markers carry the image dimensions. This mirrors pdf-lib's
// JpegEmbedder MARKERS list exactly — every marker in the 0xffc0–0xffcf frame
// range except DHT (0xffc4) — so a source JPEG's dimensions are read the same
// way pdf-lib's embedder reads them. (pdf-lib also treats 0xffc8/0xffcc as
// frame markers; we match it rather than the stricter JPEG spec, because
// agreement with the embedder is what matters here.)
const SOF_MARKERS = new Set([
  0xffc0, 0xffc1, 0xffc2, 0xffc3, 0xffc5, 0xffc6, 0xffc7, 0xffc8, 0xffc9, 0xffca,
  0xffcb, 0xffcc, 0xffcd, 0xffce, 0xffcf,
])

/**
 * Read the `{ width, height }` of a baseline/progressive JPEG from its
 * start-of-frame marker, without decoding any pixels. The export source-image
 * fallback uses this: a Page's source photo carries no recorded dimensions
 * (only its flat/enhanced results do), so when export falls all the way back to
 * the source JPEG it reads the size from the bytes.
 *
 * Throws if the bytes are not a JPEG or contain no frame marker — a captured
 * source photo is always a valid JPEG, so this only fires on corrupt input.
 */
export function jpegDimensions(bytes: Bytes): { readonly width: number; readonly height: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) {
    throw new Error('not a JPEG (missing SOI)')
  }
  let pos = 2
  let marker = 0
  while (pos + 4 <= view.byteLength) {
    marker = view.getUint16(pos)
    pos += 2
    if (SOF_MARKERS.has(marker)) break
    pos += view.getUint16(pos) // segment length covers its own 2 bytes, not the marker
  }
  if (!SOF_MARKERS.has(marker)) {
    throw new Error('JPEG has no start-of-frame marker')
  }
  pos += 2 // skip the frame segment length field -> now at precision
  // layout after precision: height (2 bytes), then width (2 bytes)
  const height = view.getUint16(pos + 1)
  const width = view.getUint16(pos + 3)
  return { width, height }
}
