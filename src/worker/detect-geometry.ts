// Pure geometry and selection policy for document-edge detection — the testable
// seam of the otherwise OpenCV-bound worker (a sibling to `flatten-geometry.ts`).
// Everything here is a pure function over plain Points (see CLAUDE.md: pure
// functions for logic); the worker runs OpenCV to extract contours and turns the
// selected contour into a Quad.

import type { Point, Quad } from '../types'

/**
 * A detected contour reduced to the fields the selection policy needs: its raw
 * points (downscaled source-pixel coords) and its absolute polygon area. Built
 * by the worker from each OpenCV contour; consumed by `pickContourIndex`.
 */
export interface ContourCandidate {
  readonly points: readonly Point[]
  readonly area: number
}

/** Options for `pickContourIndex`. */
export interface SelectOptions {
  readonly width: number
  readonly height: number
  /** Contours enclosing less than this fraction of the frame area are ignored. */
  readonly minAreaRatio: number
}

/**
 * A contour point within this fraction of the shorter frame side counts as
 * touching the frame border. The image's own border is the largest 4-gon after
 * Canny, so it always won the old "pick the biggest" rule and detection
 * returned the whole frame. Rejecting border-touching contours is what lets the
 * document — the largest *interior* contour — win instead.
 */
export const BORDER_MARGIN_FRACTION = 0.02

/** Absolute polygon area via the shoelace formula (sign-insensitive). Pure. */
export function polygonArea(points: readonly Point[]): number {
  let sum = 0
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i]
    const b = points[(i + 1) % points.length]
    sum += a.x * b.y - b.x * a.y
  }
  return Math.abs(sum) / 2
}

/**
 * Whether any of `points` (in source-pixel coords) lies within `margin` px of an
 * edge of the `width`×`height` frame. Pure; used to discard the image border.
 */
export function touchesBorder(
  points: readonly Point[],
  width: number,
  height: number,
  margin: number,
): boolean {
  return points.some(
    (pt) =>
      pt.x <= margin ||
      pt.x >= width - margin ||
      pt.y <= margin ||
      pt.y >= height - margin,
  )
}

/**
 * Whether a polygon is convex: the cross products of successive edges all share
 * a sign (collinear triples are tolerated). Pure; the force-fit sanity gate — a
 * document Quad is always convex, so a non-convex result flags a bad fit.
 */
export function isConvex(points: readonly Point[]): boolean {
  if (points.length < 3) return false
  let sign = 0
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i]
    const b = points[(i + 1) % points.length]
    const c = points[(i + 2) % points.length]
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x)
    if (cross === 0) continue
    const s = cross > 0 ? 1 : -1
    if (sign === 0) sign = s
    else if (s !== sign) return false
  }
  return true
}

/**
 * Order four points as TL, TR, BR, BL by their coordinate sums/differences:
 * TL has the smallest x+y, BR the largest; TR has the largest x−y, BL the
 * smallest. Pure. (Moved here from the worker so it is covered by unit tests —
 * which caught a latent swap of the TR/BR positions that the old "always full
 * frame" detection had been masking.)
 */
export function orderCorners(pts: readonly Point[]): Quad {
  const sum = pts.map((pt) => pt.x + pt.y)
  const diff = pts.map((pt) => pt.x - pt.y)
  const minIndex = (arr: readonly number[]): number => arr.indexOf(Math.min(...arr))
  const maxIndex = (arr: readonly number[]): number => arr.indexOf(Math.max(...arr))
  return [
    pts[minIndex(sum)], // TL: smallest x+y
    pts[maxIndex(diff)], // TR: largest x−y
    pts[maxIndex(sum)], // BR: largest x+y
    pts[minIndex(diff)], // BL: smallest x−y
  ]
}

/**
 * Force-fit selection policy (the design decision from the grilling session):
 * among contours that do NOT touch the frame border and clear the minimum-area
 * floor, pick the largest by area — the document is almost always the biggest
 * interior closed contour once the frame border is excluded. Returns its index
 * in `candidates`, or -1 when nothing survives (the worker then falls back to
 * the full frame). Pure.
 */
export function pickContourIndex(
  candidates: readonly ContourCandidate[],
  opts: SelectOptions,
): number {
  const margin = Math.min(opts.width, opts.height) * BORDER_MARGIN_FRACTION
  const minArea = opts.width * opts.height * opts.minAreaRatio
  let best = -1
  for (let i = 0; i < candidates.length; i += 1) {
    const c = candidates[i]
    if (c.area < minArea) continue
    if (touchesBorder(c.points, opts.width, opts.height, margin)) continue
    if (best === -1 || c.area > candidates[best].area) best = i
  }
  return best
}
