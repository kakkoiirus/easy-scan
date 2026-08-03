/// <reference lib="webworker" />

import * as opencv from '@techstark/opencv-js'
import type { Bytes, Point, Quad } from '../types'
import type { CvRequest, CvResponse } from './protocol'

/**
 * CV Web Worker (ADR-0002). All OpenCV.js work runs here, never on the main
 * thread, so capture/adjust UI stays responsive.
 *
 * - Boots OpenCV.js on start and reports readiness (one-shot).
 * - `detect`: decode a JPEG, find the document boundary, return its Quad.
 * - Later (M3/M4): `warp` (perspective correction) and `enhance`.
 */

const ctx = self as unknown as DedicatedWorkerGlobalScope

// @techstark/opencv-js ships TS types for the *resolved* `cv` namespace, but
// its runtime export is an Emscripten thenable that resolves to that namespace
// (under `default` via CJS interop). Probe for it so we don't depend on the
// exact interop form the bundler picks.
type CvNamespace = typeof opencv
const cvThenable = (
  (opencv as unknown as { default?: unknown }).default ?? opencv
) as unknown as Promise<CvNamespace>

let cvInstance: CvNamespace | null = null
let notified = false

// --- helpers ----------------------------------------------------------------

/** Release an OpenCV/embind object if it owns WASM memory (Mat, MatVector, Size…).
 *  Param is `unknown` because some bound types (e.g. cv.Size) don't declare `delete`. */
function dispose(value: unknown): void {
  const obj = value as { delete?: () => void }
  obj.delete?.()
}

/** Full-frame boundary (TL, TR, BR, BL) — the fallback when nothing is detected. */
function fullFrameQuad(width: number, height: number): Quad {
  return [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: height },
    { x: 0, y: height },
  ]
}

/** Scale every corner by `factor` (e.g. 1/scale to map a downscaled quad to full res). */
function scaleQuad(quad: Quad, factor: number): Quad {
  const scale = (p: Point): Point => ({ x: p.x * factor, y: p.y * factor })
  return [scale(quad[0]), scale(quad[1]), scale(quad[2]), scale(quad[3])]
}

/** Order four points as TL, TR, BR, BL by their coordinate sums/differences. */
function orderCorners(pts: readonly Point[]): Quad {
  const sum = pts.map((p) => p.x + p.y)
  const diff = pts.map((p) => p.x - p.y)
  const minIndex = (arr: readonly number[]): number => arr.indexOf(Math.min(...arr))
  const maxIndex = (arr: readonly number[]): number => arr.indexOf(Math.max(...arr))
  return [pts[minIndex(sum)], pts[maxIndex(sum)], pts[maxIndex(diff)], pts[minIndex(diff)]]
}

/** Read the four points of an approxPolyDP result (CV_32SC2, 4 rows) and order them. */
function cornersFromApprox(approx: { readonly data32S: Int32Array }): Quad {
  const d = approx.data32S
  return orderCorners([
    { x: d[0], y: d[1] },
    { x: d[2], y: d[3] },
    { x: d[4], y: d[5] },
    { x: d[6], y: d[7] },
  ])
}

/**
 * Find the largest quadrilateral contour in `imageData`, or null. Pure-ish: it
 * only mutates the OpenCV objects it creates and frees them before returning.
 * Pipeline: grayscale -> blur -> Canny -> findContours -> approxPolyDP.
 */
function detectQuad(cv: CvNamespace, imageData: ImageData): Quad | null {
  const allocated: unknown[] = []
  // Register each OpenCV object the instant it's allocated, so an exception in a
  // later allocation still frees the earlier ones (no WASM-heap leak).
  const track = <T>(value: T): T => {
    allocated.push(value)
    return value
  }
  const minArea = imageData.width * imageData.height * 0.1
  let best: { readonly pts: Quad; readonly area: number } | null = null

  try {
    const src = track(cv.matFromImageData(imageData))
    const gray = track(new cv.Mat())
    const contours = track(new cv.MatVector())
    const hierarchy = track(new cv.Mat())
    const ksize = track(new cv.Size(5, 5))
    const approx = track(new cv.Mat())

    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY)
    cv.GaussianBlur(gray, gray, ksize, 0, 0, cv.BORDER_DEFAULT)
    cv.Canny(gray, gray, 75, 200)
    cv.findContours(gray, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE)

    for (let i = 0; i < contours.size(); i += 1) {
      const contour = contours.get(i)
      try {
        const area = cv.contourArea(contour)
        if (area < minArea) continue
        const peri = cv.arcLength(contour, true)
        cv.approxPolyDP(contour, approx, 0.02 * peri, true)
        if (approx.rows === 4 && (best === null || area > best.area)) {
          best = { pts: cornersFromApprox(approx), area }
        }
      } finally {
        dispose(contour)
      }
    }
  } finally {
    for (const value of allocated) dispose(value)
  }
  return best?.pts ?? null
}

/** Decode `bytes`, detect the boundary, and return the Quad in full-source-pixel coords. */
async function detectDocument(
  bytes: Bytes,
): Promise<{ readonly quad: Quad; readonly width: number; readonly height: number }> {
  const cv = cvInstance
  if (!cv) throw new Error('OpenCV.js is not ready')

  // Decode with EXIF orientation so coords match the captured/displayed image.
  const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/jpeg' }), {
    imageOrientation: 'from-image',
  })
  try {
    const width = bitmap.width
    const height = bitmap.height

    // Downscale for speed; detection is robust at <=1024px, then map back up.
    const MAX = 1024
    const scale = Math.min(1, MAX / Math.max(width, height))
    const w = Math.max(1, Math.round(width * scale))
    const h = Math.max(1, Math.round(height * scale))

    const canvas = new OffscreenCanvas(w, h)
    const ctx2d = canvas.getContext('2d')
    if (!ctx2d) throw new Error('offscreen 2d context unavailable')
    ctx2d.drawImage(bitmap, 0, 0, w, h)
    const imageData = ctx2d.getImageData(0, 0, w, h)

    const small = detectQuad(cv, imageData)
    const quad = small ? scaleQuad(small, 1 / scale) : fullFrameQuad(width, height)
    return { quad, width, height }
  } finally {
    bitmap.close()
  }
}

// --- readiness --------------------------------------------------------------

function notifyReady(ok: boolean, version: string | null, error: string | null): void {
  if (notified) return // one-shot
  notified = true
  ctx.postMessage({ type: 'ready', ok, version, error } satisfies CvResponse)
}

/** Best-effort OpenCV build version (first line of build info), or null. Pure. */
function readVersion(cv: CvNamespace): string | null {
  try {
    const info = cv.getBuildInformation?.() ?? ''
    return info.split('\n')[0] || null
  } catch {
    return null
  }
}

function initOpenCV(): void {
  cvThenable
    .then((cv) => {
      cvInstance = cv
      notifyReady(true, readVersion(cv), null)
    })
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err)
      notifyReady(false, null, message || 'OpenCV.js failed to initialise')
    })
}

// Start loading immediately; `onmessage` is wired synchronously so ping works
// even while OpenCV is still initialising.
initOpenCV()

// --- message handling -------------------------------------------------------

async function handleDetect(
  msg: Extract<CvRequest, { readonly type: 'detect' }>,
): Promise<void> {
  try {
    const { quad, width, height } = await detectDocument(msg.bytes)
    ctx.postMessage({ type: 'detect', id: msg.id, ok: true, quad, width, height } satisfies CvResponse)
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : String(err)
    ctx.postMessage({ type: 'detect', id: msg.id, ok: false, error: error || 'detection failed' } satisfies CvResponse)
  }
}

ctx.onmessage = (event: MessageEvent) => {
  const msg = event.data as CvRequest
  switch (msg.type) {
    case 'ping':
      ctx.postMessage({ type: 'pong' } satisfies CvResponse)
      break
    case 'detect':
      void handleDetect(msg)
      break
    default:
      // Unknown message — ignore for now.
      break
  }
}
