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

// --- Touch loupe -----------------------------------------------------------
// Pure placement + crop math for the magnifier shown while a corner is dragged
// by touch (see .scratch/corner-loupe/spec.md). The loupe service renders from
// these; the corner-editor controller feeds them. All screen lengths are CSS px.

/** Loupe defaults — fixed sensible values, tunable in code (out of scope to
 *  expose to users). Diameter is derived per-viewport by `defaultLoupeDiameter`. */
export const LOUPE_ZOOM = 2.5
/** Cap on the loupe diameter in CSS px (~30% of the shorter side, capped). */
export const LOUPE_DIAMETER_CAP = 160
/** Diameter as a fraction of the shorter viewport dimension. */
export const LOUPE_DIAMETER_RATIO = 0.3

/** CSS-pixel dimensions of the viewport (loupe sizing + on-screen clamping). */
export interface Viewport {
  readonly width: number
  readonly height: number
}

/** Loupe diameter for a viewport: ~30% of the shorter side, capped so tablets
 *  don't get an oversized circle. */
export function defaultLoupeDiameter(viewport: Viewport): number {
  return Math.min(LOUPE_DIAMETER_CAP, LOUPE_DIAMETER_RATIO * Math.min(viewport.width, viewport.height))
}

/** Which side of the finger the loupe sits on. */
export type LoupeSide = 'above' | 'below'

/** On-screen placement of the circular loupe (its top-left, in CSS px). */
export interface LoupePlacement {
  readonly x: number
  readonly y: number
  readonly side: LoupeSide
}

export interface LoupePlacementInput {
  /** Finger position (clientX/clientY), in CSS px. */
  readonly finger: Point
  /** Loupe diameter, in CSS px. */
  readonly diameter: number
  /** Clearance between the finger and the loupe's nearest edge, in CSS px. */
  readonly gap: number
  readonly viewport: Viewport
}

/**
 * Place the loupe: it floats above the finger by default, flipping below when
 * there's no room above (finger near the top of the viewport); horizontally it
 * centers on the finger and clamps to keep the full circle on-screen. The
 * loupe's center is `radius + gap` from the finger, so its nearest edge clears
 * the finger by `gap`.
 */
export function placeLoupe(input: LoupePlacementInput): LoupePlacement {
  const { finger, diameter, gap, viewport } = input
  const radius = diameter / 2
  const aboveTop = finger.y - diameter - gap
  const side: LoupeSide = aboveTop >= 0 ? 'above' : 'below'
  const y = side === 'above' ? aboveTop : finger.y + gap
  const x = clamp(finger.x - radius, 0, viewport.width - diameter)
  return { x, y, side }
}

/** Source-image crop drawn inside the loupe: a square of `size` image-px. */
export interface LoupeCrop {
  /** Top-left in source-image px. */
  readonly sx: number
  readonly sy: number
  /** Edge length in source-image px. */
  readonly size: number
}

export interface LoupeCropInput {
  /** Loupe diameter, in CSS px. */
  readonly diameter: number
  /** Target magnification (e.g. 2.5 = 2.5×). */
  readonly zoom: number
  /** Editor's current CSS-px-per-image-px (the SVG CTM scale). */
  readonly editorScreenScale: number
}

/**
 * The source-image crop shown inside the loupe. Its size is
 * `diameter / (zoom · editorScreenScale)` image-px — the on-screen `diameter`
 * spans `diameter / editorScreenScale` image-px, divided by `zoom` for the
 * magnified view. It is centered on the corner (so the reticle marks the exact
 * corner) and deliberately not clamped: at an image edge the crop extends past
 * the photo rather than sliding off the corner.
 */
export function loupeCrop(corner: Point, input: LoupeCropInput): LoupeCrop {
  const size = input.diameter / (input.zoom * input.editorScreenScale)
  return { sx: corner.x - size / 2, sy: corner.y - size / 2, size }
}
