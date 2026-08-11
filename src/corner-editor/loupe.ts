import type { Point } from '../types'
import { defaultLoupeDiameter, LOUPE_ZOOM, loupeCrop, placeLoupe, type Viewport } from './geometry'

/**
 * Imperative touch-loupe service (lives outside React's render cycle — same
 * pattern as `camera-controller` and `corner-editor`, see CLAUDE.md). While a
 * corner is dragged by touch, the corner-editor controller drives this directly
 * from its pointer handlers: show on grab, move on each pointermove, hide on
 * release. The per-move canvas redraw therefore never touches React's
 * reconciliation.
 *
 * Owns a single `<canvas>` it creates, appends to `document.body` on `mount`,
 * and removes on `unmount`. The canvas is `position: fixed`, circular,
 * `pointer-events: none` (it must never intercept drags), high z-index, and
 * rendered at `devicePixelRatio` for crispness. It decodes the source photo
 * into its own `HTMLImageElement` (browser-cached, since the editor's `<image>`
 * already decoded it).
 *
 * All placement + crop decisions are delegated to the pure functions in
 * `geometry.ts` (the tested seam); this module is the impure rendering surface,
 * verified manually per the spec's testing decision.
 */

/** Clearance between the finger and the loupe's nearest edge, in CSS px. */
const LOUPE_GAP = 12

export interface Loupe {
  /** Append the canvas to `document.body`. Idempotent. */
  readonly mount: () => void
  /** Remove the canvas from the DOM. Idempotent; also hides. */
  readonly unmount: () => void
  /** Decode `src` into the loupe's own image. Supersedes any in-flight decode. */
  readonly setSource: (src: string) => void
  /** Size for the current viewport and fade in. No-op if not mounted. */
  readonly show: () => void
  /** Recompute placement + crop and redraw, anchored to `finger` and centered on
   *  `corner` (source-image px). No-op if not shown or the image isn't ready. */
  readonly move: (corner: Point, finger: Point, editorScreenScale: number) => void
  /** Fade out. */
  readonly hide: () => void
  /** Full teardown: unmount, drop the image, and invalidate any in-flight decode. */
  readonly destroy: () => void
}

export function createLoupe(): Loupe {
  const canvas = document.createElement('canvas')
  canvas.className = 'corner-loupe'
  const ctx = canvas.getContext('2d')

  let diameter = 0
  let mounted = false
  let visible = false
  let image: HTMLImageElement | null = null
  let imageReady = false
  /** Bumped on each `setSource`/`destroy`; an in-flight decode whose generation
   *  no longer matches is stale and ignored. */
  let sourceGen = 0

  function viewport(): Viewport {
    return { width: window.innerWidth, height: window.innerHeight }
  }

  /** (Re)size the canvas backing store for the current viewport + DPR. */
  function applySize(): void {
    const dpr = window.devicePixelRatio || 1
    diameter = defaultLoupeDiameter(viewport())
    canvas.style.width = `${diameter}px`
    canvas.style.height = `${diameter}px`
    canvas.width = Math.round(diameter * dpr)
    canvas.height = Math.round(diameter * dpr)
  }

  function drawReticle(c: CanvasRenderingContext2D, d: number): void {
    const center = d / 2
    // Halo first (dark, thicker) so the reticle reads on any photo content,
    // then the crisp white reticle on top.
    const ringR = Math.max(6, d * 0.09)
    const arm = Math.max(8, d * 0.12)
    c.lineCap = 'round'
    for (const [color, width] of [
      ['rgba(0,0,0,0.55)', 3],
      ['#ffffff', 1.5],
    ] as const) {
      c.strokeStyle = color
      c.lineWidth = width
      c.beginPath()
      c.arc(center, center, ringR, 0, Math.PI * 2)
      c.stroke()
      c.beginPath()
      c.moveTo(center - arm, center)
      c.lineTo(center + arm, center)
      c.moveTo(center, center - arm)
      c.lineTo(center, center + arm)
      c.stroke()
    }
    // Subtle outer border so the circle reads against the photo.
    c.lineWidth = 2
    c.strokeStyle = 'rgba(255,255,255,0.9)'
    c.beginPath()
    c.arc(center, center, d / 2 - 1, 0, Math.PI * 2)
    c.stroke()
  }

  function render(corner: Point, finger: Point, editorScreenScale: number): void {
    if (!ctx || !imageReady || !image || diameter === 0) return
    if (editorScreenScale <= 0) return // svg not laid out yet — can't map sizes
    const dpr = window.devicePixelRatio || 1
    const place = placeLoupe({ finger, diameter, gap: LOUPE_GAP, viewport: viewport() })
    canvas.style.transform = `translate3d(${place.x}px, ${place.y}px, 0)`
    const crop = loupeCrop(corner, { diameter, zoom: LOUPE_ZOOM, editorScreenScale })

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, diameter, diameter)
    ctx.save()
    ctx.beginPath()
    ctx.arc(diameter / 2, diameter / 2, diameter / 2, 0, Math.PI * 2)
    ctx.clip()
    // Fill first so the area beyond the photo (a corner clamped to the edge)
    // reads dark rather than transparent.
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, diameter, diameter)
    ctx.drawImage(image, crop.sx, crop.sy, crop.size, crop.size, 0, 0, diameter, diameter)
    ctx.restore()
    drawReticle(ctx, diameter)
  }

  function mount(): void {
    if (mounted) return
    document.body.appendChild(canvas)
    mounted = true
  }

  function unmount(): void {
    if (!mounted) return
    canvas.remove()
    mounted = false
    hide()
  }

  function setSource(src: string): void {
    const gen = ++sourceGen
    imageReady = false
    const img = new Image()
    img.onload = () => {
      if (gen !== sourceGen) return // superseded by a later setSource / destroyed
      image = img
      imageReady = true
    }
    img.src = src
  }

  function show(): void {
    if (!mounted) return
    applySize()
    visible = true
    canvas.classList.add('is-visible')
  }

  function move(corner: Point, finger: Point, editorScreenScale: number): void {
    if (!visible) return
    render(corner, finger, editorScreenScale)
  }

  function hide(): void {
    visible = false
    canvas.classList.remove('is-visible')
  }

  function destroy(): void {
    sourceGen += 1 // invalidate any in-flight decode
    unmount()
    image = null
    imageReady = false
  }

  return { mount, unmount, setSource, show, move, hide, destroy }
}
