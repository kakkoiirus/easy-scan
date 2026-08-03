// Pure geometry for corner adjustment — the testable seam of the otherwise
// DOM/pointer-bound editor. Everything here is a pure function over points and
// the source-image size (see CLAUDE.md: pure functions for logic).

import type { Point, Quad } from '../types'

/** Pixel dimensions of the source photo a Quad is measured against. */
export interface CornerImageSize {
  readonly width: number
  readonly height: number
}

const clamp = (v: number, min: number, max: number): number => (v < min ? min : v > max ? max : v)

/** Constrain a point to the image rectangle so a corner can't leave the photo. */
export function clampPoint(p: Point, size: CornerImageSize): Point {
  return { x: clamp(p.x, 0, size.width), y: clamp(p.y, 0, size.height) }
}

/**
 * Index of the corner closest to `p` within `radius` (in image pixels), or null
 * if none is close enough to grab. Ties go to the nearer corner. Used for
 * hit-testing on pointer down — the grab target is deliberately larger than the
 * visible dot so a finger lands reliably.
 */
export function nearestCornerIndex(quad: Quad, p: Point, radius: number): number | null {
  const r2 = radius * radius
  let best: number | null = null
  let bestD = r2
  for (let i = 0; i < quad.length; i += 1) {
    const c = quad[i]
    const d = (c.x - p.x) ** 2 + (c.y - p.y) ** 2
    if (d <= bestD) {
      bestD = d
      best = i
    }
  }
  return best
}

/** Grab radius in image-pixel coords — a generous fraction of the long edge. */
export function hitRadius(size: CornerImageSize): number {
  return Math.max(size.width, size.height) * 0.08
}

/** Full-frame boundary (TL, TR, BR, BL) — the editable fallback Quad. */
export function fullFrameQuad(size: CornerImageSize): Quad {
  return [
    { x: 0, y: 0 },
    { x: size.width, y: 0 },
    { x: size.width, y: size.height },
    { x: 0, y: size.height },
  ]
}
