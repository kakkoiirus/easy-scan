// Pure geometry for the warp ("flatten") step — the testable seam of the
// otherwise OpenCV-bound worker. Everything here is a pure function over the
// source Quad (see CLAUDE.md: pure functions for logic); the worker turns the
// result into a perspective-transform matrix.
//
// The flat rectangle is sized by the Quad's edge lengths: the longer of the two
// horizontal edges becomes the width, the longer of the two vertical edges
// becomes the height. Taking the max (not the average) guarantees the warped
// content is never cropped — the longest edge defines the page side.

import type { Point, Quad } from '../types'

/** A flat page side shorter than this is treated as degenerate (see below). */
export const MIN_FLAT_SIDE = 1
/** A Quad enclosing less than this many square pixels is treated as degenerate. */
export const MIN_FLAT_AREA = 1

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

/** Absolute area of a Quad via the shoelace formula (0 when the corners are collinear). */
function quadArea(quad: Quad): number {
  let sum = 0
  for (let i = 0; i < 4; i += 1) {
    const a = quad[i]
    const b = quad[(i + 1) % 4]
    sum += a.x * b.y - b.x * a.y
  }
  return Math.abs(sum) / 2
}

/**
 * Pixel dimensions of the flat rectangle a Quad warps into, or null when the
 * Quad is degenerate — collinear (zero-area) corners, a sub-min side, or
 * NaN/Infinity coordinates — so the worker can fail gracefully instead of
 * feeding OpenCV a singular transform that crashes or produces garbage.
 *
 * The Quad is ordered TL, TR, BR, BL. Note a genuinely skinny-but-valid Quad
 * (e.g. 4000×2) has a non-zero area and warps fine; only (near-)collinear input
 * is rejected.
 */
export function computeFlatSize(quad: Quad): { readonly width: number; readonly height: number } | null {
  const [tl, tr, br, bl] = quad
  const width = Math.max(distance(tl, tr), distance(bl, br))
  const height = Math.max(distance(tl, bl), distance(tr, br))
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null
  if (width < MIN_FLAT_SIDE || height < MIN_FLAT_SIDE) return null
  if (quadArea(quad) < MIN_FLAT_AREA) return null
  return { width: Math.round(width), height: Math.round(height) }
}
