import type { Point, Quad } from '../types'
import { clampPoint, hitRadius, nearestCornerIndex, type CornerImageSize } from './geometry'

/**
 * Imperative corner-editor service (lives outside React's render cycle — see the
 * architecture note in CLAUDE.md, same pattern as `camera-controller`). Pointer
 * events are bound straight to the `<svg>`; the 60fps-ish pointermove work
 * never touches React's reconciliation — React only re-renders the four corner
 * dots via `useSyncExternalStore` when the live Quad actually changes.
 *
 * A factory (not a singleton like the camera controller) because each editor
 * mount edits a different source image; instance state stays isolated.
 *
 * Pointer/coordinate mapping is browser-integration code, verified manually
 * (secure context + a real image) per the M2/M3 testing decision.
 */

export interface CornerEditorController {
  /** Bind pointer handling to `svg`. Call once per mount — listeners must survive
   *  re-renders (a drag re-renders every move) so the active corner isn't dropped
   *  mid-drag. Returns a detach fn. */
  readonly attach: (svg: SVGSVGElement) => () => void
  /** Set the source-image size (config for clamp + hit-radius), without re-binding. */
  readonly setImage: (image: CornerImageSize) => void
  /** Replace the Quad being edited (null = no overlay / not editable yet). */
  readonly setQuad: (quad: Quad | null) => void
  /** The live Quad (for `useSyncExternalStore` getSnapshot). */
  readonly getQuad: () => Quad | null
  /** Subscribe to Quad changes (for `useSyncExternalStore`). */
  readonly subscribe: (cb: () => void) => () => void
}

export function createCornerEditor(): CornerEditorController {
  let current: Quad | null = null
  let image: CornerImageSize | null = null
  let svg: SVGSVGElement | null = null
  /** Index of the corner being dragged, or null when idle. Fixed index => the
   *  TL/TR/BR/BL order can't be reordered by dragging. */
  let activeIndex: number | null = null
  const listeners = new Set<() => void>()

  function emit(): void {
    for (const listener of listeners) listener()
  }

  /** Map a screen (client) point to source-image pixel coords via the svg CTM.
   *  Accounts for the `xMidYMid meet` letterboxing, so grabs track the visible
   *  photo exactly. Returns null if the svg isn't measurable yet.
   *
   *  Uses the classic `createSVGPoint` + `matrixTransform` form because
   *  `getScreenCTM()` may return a legacy `SVGMatrix` (no `transformPoint`),
   *  so the newer `DOMPoint`/`DOMMatrix.transformPoint` API can't be relied on
   *  across browsers. */
  function clientToImage(clientX: number, clientY: number): Point | null {
    if (!svg) return null
    const ctm = svg.getScreenCTM()
    if (!ctm) return null
    const pt = svg.createSVGPoint()
    pt.x = clientX
    pt.y = clientY
    const img = pt.matrixTransform(ctm.inverse())
    return { x: img.x, y: img.y }
  }

  function onPointerDown(e: PointerEvent): void {
    if (current === null || image === null) return
    const p = clientToImage(e.clientX, e.clientY)
    if (!p) return
    const idx = nearestCornerIndex(current, p, hitRadius(image))
    if (idx === null) return
    activeIndex = idx
    e.preventDefault() // suppress text-selection / image drag
    try {
      svg?.setPointerCapture(e.pointerId) // keep receiving moves past the dot
    } catch {
      // Some browsers throw if the pointer is already released; safe to ignore.
    }
  }

  function onPointerMove(e: PointerEvent): void {
    if (activeIndex === null || current === null || image === null) return
    const p = clientToImage(e.clientX, e.clientY)
    if (!p) return
    const clamped = clampPoint(p, image)
    // Move only the grabbed corner; the other three keep their places, so the
    // TL/TR/BR/BL ordering is preserved by construction.
    const next: Quad = [
      activeIndex === 0 ? clamped : current[0],
      activeIndex === 1 ? clamped : current[1],
      activeIndex === 2 ? clamped : current[2],
      activeIndex === 3 ? clamped : current[3],
    ]
    current = next
    e.preventDefault()
    emit()
  }

  function endDrag(e: PointerEvent): void {
    if (activeIndex === null) return
    activeIndex = null
    try {
      svg?.releasePointerCapture(e.pointerId)
    } catch {
      // Pointer may already be released; safe to ignore.
    }
  }

  /** Cancel the browser's native image drag-and-drop, which on mouse otherwise
   *  hijacks the pointer and starves our pointermove handler. */
  function killNativeDrag(e: Event): void {
    e.preventDefault()
  }

  function attach(el: SVGSVGElement): () => void {
    svg = el
    el.addEventListener('pointerdown', onPointerDown)
    el.addEventListener('pointermove', onPointerMove)
    el.addEventListener('pointerup', endDrag)
    el.addEventListener('pointercancel', endDrag)
    el.addEventListener('dragstart', killNativeDrag)
    return () => {
      el.removeEventListener('pointerdown', onPointerDown)
      el.removeEventListener('pointermove', onPointerMove)
      el.removeEventListener('pointerup', endDrag)
      el.removeEventListener('pointercancel', endDrag)
      el.removeEventListener('dragstart', killNativeDrag)
      activeIndex = null
      if (svg === el) svg = null
    }
  }

  function setImage(size: CornerImageSize): void {
    image = size
  }

  function setQuad(quad: Quad | null): void {
    if (quad === current) return // same reference — no change, no emit
    current = quad
    emit()
  }

  function getQuad(): Quad | null {
    return current
  }

  function subscribe(cb: () => void): () => void {
    listeners.add(cb)
    return () => {
      listeners.delete(cb)
    }
  }

  return { attach, setImage, setQuad, getQuad, subscribe }
}
