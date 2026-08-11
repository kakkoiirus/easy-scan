import type { Point, Quad } from '../types'
import { clampPoint, hitRadius, nearestCornerIndex, type CornerImageSize } from './geometry'
import type { Loupe } from './loupe'

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

/** Options for `createCornerEditor`. `loupe` is optional: when present it is
 *  driven for touch drags only (mouse/pen are precise pointers, no loupe). */
export interface CornerEditorOptions {
  readonly loupe?: Loupe
}

export function createCornerEditor(options: CornerEditorOptions = {}): CornerEditorController {
  const loupe = options.loupe ?? null
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

  /** Map a screen (client) point to source-image pixel coords via the svg CTM,
   *  and report the CTM's scale (CSS-px-per-image-px) — the loupe needs it for
   *  its crop-size formula. Accounts for the `xMidYMid meet` letterboxing, so
   *  grabs track the visible photo exactly. Returns null if the svg isn't
   *  measurable yet.
   *
   *  Uses the classic `createSVGPoint` + `matrixTransform` form because
   *  `getScreenCTM()` may return a legacy `SVGMatrix` (no `transformPoint`),
   *  so the newer `DOMPoint`/`DOMMatrix.transformPoint` API can't be relied on
   *  across browsers. */
  function resolvePointer(
    clientX: number,
    clientY: number,
  ): { point: Point; scale: number } | null {
    if (!svg) return null
    const ctm = svg.getScreenCTM()
    if (!ctm) return null
    const pt = svg.createSVGPoint()
    pt.x = clientX
    pt.y = clientY
    const img = pt.matrixTransform(ctm.inverse())
    return { point: { x: img.x, y: img.y }, scale: ctm.a }
  }

  function onPointerDown(e: PointerEvent): void {
    if (current === null || image === null) return
    const resolved = resolvePointer(e.clientX, e.clientY)
    if (!resolved) return
    const idx = nearestCornerIndex(current, resolved.point, hitRadius(image))
    if (idx === null) return
    activeIndex = idx
    e.preventDefault() // suppress text-selection / image drag
    try {
      svg?.setPointerCapture(e.pointerId) // keep receiving moves past the dot
    } catch {
      // Some browsers throw if the pointer is already released; safe to ignore.
    }
    // Touch only: a finger covers the corner it's dragging, so reveal the loupe
    // straight away (centered on the grabbed corner, anchored to the finger).
    if (e.pointerType === 'touch' && loupe) {
      loupe.show()
      loupe.move(current[idx], { x: e.clientX, y: e.clientY }, resolved.scale)
    }
  }

  function onPointerMove(e: PointerEvent): void {
    if (activeIndex === null || current === null || image === null) return
    const resolved = resolvePointer(e.clientX, e.clientY)
    if (!resolved) return
    const clamped = clampPoint(resolved.point, image)
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
    // The loupe crop follows the *clamped* corner (where the dot actually is),
    // while its on-screen position tracks the *finger* — they diverge at image
    // edges, where the user must see the corner, not the finger.
    if (e.pointerType === 'touch' && loupe) {
      loupe.move(clamped, { x: e.clientX, y: e.clientY }, resolved.scale)
    }
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
    if (e.pointerType === 'touch' && loupe) loupe.hide()
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
