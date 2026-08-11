import { describe, expect, it } from 'vitest'
import type { Point } from '../types'
import {
  clampPoint,
  defaultLoupeDiameter,
  fullFrameQuad,
  loupeCrop,
  nearestCornerIndex,
  placeLoupe,
} from './geometry'

const p = (x: number, y: number): Point => ({ x, y })

// This is the first unit test for the corner editor's pure-geometry seam — the
// testable surface of the otherwise DOM/pointer-bound editor (see the testing
// decision in .scratch/corner-loupe/spec.md). The loupe functions encode every
// placement/crop decision; the existing functions are covered to establish the
// seam.

describe('clampPoint', () => {
  const size = { width: 100, height: 200 }
  it('passes through an interior point', () => {
    expect(clampPoint(p(50, 50), size)).toEqual(p(50, 50))
  })
  it('clamps each axis to the image rectangle', () => {
    expect(clampPoint(p(-10, 250), size)).toEqual(p(0, 200))
    expect(clampPoint(p(999, -5), size)).toEqual(p(100, 0))
  })
})

describe('nearestCornerIndex', () => {
  const quad = [p(0, 0), p(100, 0), p(100, 100), p(0, 100)] as const
  it('returns the closest corner within the grab radius', () => {
    expect(nearestCornerIndex(quad, p(8, 6), 10)).toBe(0)
    expect(nearestCornerIndex(quad, p(95, 5), 10)).toBe(1)
  })
  it('returns null when nothing is close enough', () => {
    expect(nearestCornerIndex(quad, p(50, 50), 10)).toBeNull()
  })
})

describe('fullFrameQuad', () => {
  it('builds the TL/TR/BR/BL rectangle for the image', () => {
    expect(fullFrameQuad({ width: 100, height: 200 })).toEqual([
      p(0, 0),
      p(100, 0),
      p(100, 200),
      p(0, 200),
    ])
  })
})

describe('defaultLoupeDiameter', () => {
  it('is ~30% of the shorter viewport side when under the cap', () => {
    // Portrait phone: shorter side is the width.
    expect(defaultLoupeDiameter({ width: 390, height: 844 })).toBeCloseTo(117, 5)
  })
  it('caps at ~160px on larger screens', () => {
    expect(defaultLoupeDiameter({ width: 1024, height: 768 })).toBe(160)
  })
})

describe('placeLoupe', () => {
  const diameter = 120
  const gap = 16
  const viewport = { width: 390, height: 844 }

  it('floats above the finger by default, centered horizontally on it', () => {
    const finger = p(200, 400)
    const place = placeLoupe({ finger, diameter, gap, viewport })
    expect(place.side).toBe('above')
    // Nearest edge sits `gap` above the finger; circle top is diameter above that.
    expect(place.y).toBe(400 - diameter - gap)
    // Horizontally centered on the finger.
    expect(place.x).toBe(200 - diameter / 2)
  })

  it('flips below the finger when there is no room above', () => {
    // Finger near the very top: aboveTop = 40 - 120 - 16 < 0.
    const finger = p(200, 40)
    const place = placeLoupe({ finger, diameter, gap, viewport })
    expect(place.side).toBe('below')
    // Top edge sits `gap` below the finger.
    expect(place.y).toBe(40 + gap)
  })

  it('stays above when there is exactly room (aboveTop === 0)', () => {
    // aboveTop = finger.y - diameter - gap === 0 → exactly fits.
    const finger = p(200, diameter + gap)
    const place = placeLoupe({ finger, diameter, gap, viewport })
    expect(place.side).toBe('above')
    expect(place.y).toBe(0)
  })

  it('clamps left so the full circle stays on-screen', () => {
    const finger = p(10, 400) // finger near the left edge
    const place = placeLoupe({ finger, diameter, gap, viewport })
    expect(place.x).toBe(0)
  })

  it('clamps right so the full circle stays on-screen', () => {
    const finger = p(385, 400) // finger near the right edge
    const place = placeLoupe({ finger, diameter, gap, viewport })
    expect(place.x).toBe(viewport.width - diameter)
  })
})

describe('loupeCrop', () => {
  it('sizes the crop so the loupe magnifies at the target zoom', () => {
    // diameter 100 CSS px, zoom 2.5×, editor shows 2 CSS px per image px →
    // the on-screen 100 CSS px spans 100 / 2 = 50 image px, then /2.5 zoom = 20.
    const crop = loupeCrop(p(0, 0), { diameter: 100, zoom: 2.5, editorScreenScale: 2 })
    expect(crop.size).toBe(20)
  })

  it('centers the crop on the corner (reticle marks the exact corner)', () => {
    const corner = p(300, 500)
    const crop = loupeCrop(corner, { diameter: 100, zoom: 2.5, editorScreenScale: 2 })
    expect(crop.sx + crop.size / 2).toBeCloseTo(corner.x, 5)
    expect(crop.sy + crop.size / 2).toBeCloseTo(corner.y, 5)
  })

  it('keeps the crop centered when the corner is at the image edge (no clamp)', () => {
    // A corner clamped to (0,0): the crop extends into negatives so the center
    // — and thus the reticle — still marks the corner exactly.
    const crop = loupeCrop(p(0, 0), { diameter: 100, zoom: 2.5, editorScreenScale: 2 })
    expect(crop.sx).toBe(-crop.size / 2)
    expect(crop.sy).toBe(-crop.size / 2)
  })
})
