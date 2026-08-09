import { describe, expect, it } from 'vitest'
import type { Point } from '../types'
import {
  isConvex,
  orderCorners,
  pickContourIndex,
  polygonArea,
  touchesBorder,
} from './detect-geometry'

const p = (x: number, y: number): Point => ({ x, y })

describe('polygonArea', () => {
  it('measures a square', () => {
    expect(polygonArea([p(0, 0), p(10, 0), p(10, 10), p(0, 10)])).toBe(100)
  })
  it('is sign-insensitive for a clockwise winding', () => {
    expect(polygonArea([p(0, 0), p(0, 10), p(10, 10), p(10, 0)])).toBe(100)
  })
  it('measures a triangle', () => {
    expect(polygonArea([p(0, 0), p(10, 0), p(0, 10)])).toBe(50)
  })
})

describe('touchesBorder', () => {
  it('flags a vertex on the edge', () => {
    expect(touchesBorder([p(0, 5), p(50, 50)], 100, 100, 2)).toBe(true)
  })
  it('passes a fully interior contour', () => {
    expect(touchesBorder([p(20, 20), p(80, 20), p(80, 80), p(20, 80)], 100, 100, 2)).toBe(false)
  })
})

describe('isConvex', () => {
  it('treats a square as convex', () => {
    expect(isConvex([p(0, 0), p(10, 0), p(10, 10), p(0, 10)])).toBe(true)
  })
  it('treats an arrowhead as non-convex', () => {
    expect(isConvex([p(0, 0), p(10, 5), p(0, 10), p(3, 5)])).toBe(false)
  })
})

describe('orderCorners', () => {
  it('orders any winding as TL, TR, BR, BL', () => {
    const tl = p(0, 0)
    const tr = p(10, 0)
    const br = p(10, 10)
    const bl = p(0, 10)
    expect(orderCorners([br, tl, bl, tr])).toEqual([tl, tr, br, bl])
  })
})

describe('pickContourIndex', () => {
  const opts = { width: 100, height: 100, minAreaRatio: 0.1 }

  // The regression that motivated this rewrite: the frame border is the largest
  // 4-gon, so the old "biggest wins" rule always returned the whole frame.
  it('prefers the largest interior contour over a bigger border-touching one', () => {
    const border = { points: [p(0, 0), p(100, 0), p(100, 100), p(0, 100)], area: 10000 }
    const doc = { points: [p(20, 20), p(80, 20), p(80, 80), p(20, 80)], area: 3600 }
    expect(pickContourIndex([border, doc], opts)).toBe(1)
  })

  it('returns -1 when only the frame border is present', () => {
    const border = { points: [p(0, 0), p(100, 0), p(100, 100), p(0, 100)], area: 10000 }
    expect(pickContourIndex([border], opts)).toBe(-1)
  })

  it('ignores candidates below the area floor', () => {
    const tiny = { points: [p(40, 40), p(45, 40), p(45, 45), p(40, 45)], area: 25 }
    expect(pickContourIndex([tiny], opts)).toBe(-1)
  })
})
