import { PDFDocument } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import type { Bytes } from '../types'
import { assemblePdf } from './assemble-pdf'

// The pure assembly seam (spec M7) is the test target: given ordered page
// images it yields a valid multi-page PDF whose pages match the inputs' aspects.
// We never decode pixels — only the PDF *structure* — so the page images are
// hand-crafted minimal JPEGs (SOI + SOF0 + EOI) that pdf-lib embeds. pdf-lib
// reads only the SOF marker for dimensions, so these tiny buffers are enough.
// The dimensions under test come from the explicit inputs we pass to
// `assemblePdf`, an independent source of truth — not from the JPEG bytes.

/** Build a minimal grayscale JPEG whose intrinsic size is width × height. The
 *  bytes are never decoded; only the SOF marker is consulted. An optional
 *  leading APP0 segment proves callers really scan for the frame marker. */
function grayJpeg(
  width: number,
  height: number,
  opts: { withAppSegment?: boolean } = {},
): Bytes {
  const prefix = opts.withAppSegment
    ? Uint8Array.of(0xff, 0xe0, 0x00, 0x06, 0x4a, 0x46, 0x49, 0x46) // APP0 w/ 4-byte payload
    : new Uint8Array(0)
  const frame = new Uint8Array(15)
  const dv = new DataView(frame.buffer)
  dv.setUint16(0, 0xffc0) // SOF0 marker
  dv.setUint16(2, 0x000b) // segment length (11)
  dv.setUint8(4, 8) // precision
  dv.setUint16(5, height) // height
  dv.setUint16(7, width) // width
  dv.setUint8(9, 1) // 1 component (grayscale)
  frame[10] = 1
  frame[11] = 0x11
  frame[12] = 0
  dv.setUint16(13, 0xffd9) // EOI
  const bytes = new Uint8Array(2 + prefix.length + frame.length)
  bytes[0] = 0xff
  bytes[1] = 0xd8 // SOI
  bytes.set(prefix, 2)
  bytes.set(frame, 2 + prefix.length)
  return bytes
}

async function reload(bytes: Bytes): Promise<PDFDocument> {
  return PDFDocument.load(bytes)
}

describe('assemblePdf', () => {
  it('produces a valid single-page PDF whose page matches the input size', async () => {
    const bytes = await assemblePdf([{ bytes: grayJpeg(10, 6), width: 10, height: 6 }])

    // Valid PDF: the magic header is present (independent structural check).
    expect(String.fromCharCode(...bytes.slice(0, 5))).toBe('%PDF-')
    const pdf = await reload(bytes)
    expect(pdf.getPageCount()).toBe(1)
    const page = pdf.getPage(0)
    expect(page.getWidth()).toBe(10)
    expect(page.getHeight()).toBe(6)
  })

  it('emits one page per image, in order, each matching its own aspect', async () => {
    const bytes = await assemblePdf([
      { bytes: grayJpeg(12, 6), width: 12, height: 6 }, // landscape 2:1
      { bytes: grayJpeg(4, 8), width: 4, height: 8 }, // portrait 1:2
      { bytes: grayJpeg(5, 5), width: 5, height: 5 }, // square 1:1
    ])

    const pdf = await reload(bytes)
    expect(pdf.getPageCount()).toBe(3)
    const pages = pdf.getPages()
    expect([pages[0]!.getWidth(), pages[0]!.getHeight()]).toEqual([12, 6])
    expect([pages[1]!.getWidth(), pages[1]!.getHeight()]).toEqual([4, 8])
    expect([pages[2]!.getWidth(), pages[2]!.getHeight()]).toEqual([5, 5])
  })

  it('embeds JPEGs that carry a leading APP segment (still scans to the frame)', async () => {
    // A real JPEG has APP0/JFIF before the SOF; the embedder must skip it.
    const bytes = await assemblePdf([{ bytes: grayJpeg(7, 3, { withAppSegment: true }), width: 7, height: 3 }])

    const pdf = await reload(bytes)
    expect(pdf.getPageCount()).toBe(1)
    expect(pdf.getPage(0).getWidth()).toBe(7)
  })

  it('never throws on an empty input — it still returns valid PDF bytes', async () => {
    // A Document always has at least one page, so this is defensive only; the
    // contract that matters is that an empty input can't crash the caller.
    const bytes = await assemblePdf([])

    expect(String.fromCharCode(...bytes.slice(0, 5))).toBe('%PDF-')
  })
})
