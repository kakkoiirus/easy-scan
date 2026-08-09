import { describe, expect, it } from 'vitest'
import type { Bytes } from '../types'
import { jpegDimensions } from './jpeg-dimensions'

// Pure JPEG dimension parsing is the source-image fallback's only way to size a
// PDF page: a captured Page carries no recorded width/height on its source
// photo (only the flat/enhanced results do), so when export falls all the way
// back to the source JPEG we must read its dimensions from the bytes. We craft
// minimal JPEGs by hand so the expected dimensions are an independent literal,
// not derived the way the parser reads them.

/** Minimal JPEG: SOI [APP0?] | SOF(precision, height, width, Nf, components) | EOI.
 *  `marker` selects the frame type (SOF0 baseline / SOF2 progressive …). */
function jpeg(
  width: number,
  height: number,
  opts: { marker?: number; withAppSegment?: boolean; components?: number } = {},
): Bytes {
  const marker = opts.marker ?? 0xffc0
  const components = opts.components ?? 1
  const prefix = opts.withAppSegment
    ? Uint8Array.of(0xff, 0xe0, 0x00, 0x06, 0x4a, 0x46, 0x49, 0x46) // APP0 w/ 4-byte payload
    : new Uint8Array(0)
  const compSpecLen = components * 3
  const frameLen = 2 + 1 + 2 + 2 + 1 + compSpecLen // length + prec + h + w + Nf + specs
  const frame = new Uint8Array(2 + frameLen)
  const fv = new DataView(frame.buffer)
  fv.setUint16(0, marker)
  fv.setUint16(2, frameLen)
  fv.setUint8(4, 8) // precision
  fv.setUint16(5, height)
  fv.setUint16(7, width)
  fv.setUint8(9, components)
  const bytes = new Uint8Array(2 + prefix.length + frame.length + 2)
  bytes[0] = 0xff
  bytes[1] = 0xd8 // SOI
  bytes.set(prefix, 2)
  bytes.set(frame, 2 + prefix.length)
  const eoi = 2 + prefix.length + frame.length
  bytes[eoi] = 0xff
  bytes[eoi + 1] = 0xd9
  return bytes as Bytes
}

describe('jpegDimensions', () => {
  it('reads width and height from a baseline (SOF0) grayscale JPEG', () => {
    expect(jpegDimensions(jpeg(2480, 3508))).toEqual({ width: 2480, height: 3508 })
  })

  it('skips a leading APP0 segment to reach the frame marker', () => {
    expect(jpegDimensions(jpeg(40, 30, { withAppSegment: true }))).toEqual({ width: 40, height: 30 })
  })

  it('reads dims from a progressive JPEG (SOF2, 0xffc2)', () => {
    expect(jpegDimensions(jpeg(100, 25, { marker: 0xffc2 }))).toEqual({ width: 100, height: 25 })
  })

  it('reads dims from a 3-component (RGB) frame', () => {
    expect(jpegDimensions(jpeg(16, 9, { components: 3 }))).toEqual({ width: 16, height: 9 })
  })

  it('throws on bytes without a JPEG SOI', () => {
    expect(() => jpegDimensions(new Uint8Array([1, 2, 3]) as Bytes)).toThrow()
  })

  it('throws when no frame marker is present', () => {
    // SOI + an APP segment only, no SOF.
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x4a, 0x46])
    expect(() => jpegDimensions(bytes as Bytes)).toThrow()
  })
})
