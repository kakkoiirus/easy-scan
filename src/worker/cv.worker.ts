/// <reference lib="webworker" />

import * as opencv from '@techstark/opencv-js'
import type { Bytes, EnhanceMode, Point, Quad } from '../types'
import { computeFlatSize } from './flatten-geometry'
import {
  isConvex,
  orderCorners,
  pickContourIndex,
  polygonArea,
  type ContourCandidate,
} from './detect-geometry'
import type { CvRequest, CvResponse } from './protocol'

/**
 * CV Web Worker (ADR-0002). All OpenCV.js work runs here, never on the main
 * thread, so capture/adjust UI stays responsive.
 *
 * - Boots OpenCV.js on start and reports readiness (one-shot).
 * - `detect`: decode a JPEG, find the document boundary, return its Quad.
 * - `warp`: decode a JPEG + its Quad, perspective-correct into a flat rectangle.
 * - `enhance`: decode a flat JPEG + a mode, apply the enhancement, return JPEG bytes.
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

/** Read the points of a CV_32SC2 Mat (a findContours/convexHull/approxPolyDP
 *  result) as plain Points — `rows` points, two ints each. */
function contourPoints(contour: { readonly rows: number; readonly data32S: Int32Array }): Point[] {
  const d = contour.data32S
  const n = contour.rows
  const pts: Point[] = []
  for (let i = 0; i < n; i += 1) {
    pts.push({ x: d[i * 2], y: d[i * 2 + 1] })
  }
  return pts
}

/** The four corners of an OpenCV `RotatedRect` (`minAreaRect` output), rotated
 *  about its centre. OpenCV's `angle` is clockwise in screen space (y grows down). */
function rotatedRectCorners(rect: {
  readonly center: Point
  readonly size: { readonly width: number; readonly height: number }
  readonly angle: number
}): Point[] {
  const angle = (rect.angle * Math.PI) / 180
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  const hw = rect.size.width / 2
  const hh = rect.size.height / 2
  const cx = rect.center.x
  const cy = rect.center.y
  const local: readonly Point[] = [
    { x: -hw, y: -hh },
    { x: hw, y: -hh },
    { x: hw, y: hh },
    { x: -hw, y: hh },
  ]
  return local.map((pt) => ({
    x: cx + pt.x * cos - pt.y * sin,
    y: cy + pt.x * sin + pt.y * cos,
  }))
}

/**
 * Find the document boundary in `imageData`, or null. Pure-ish: it only mutates
 * the OpenCV objects it creates and frees them before returning.
 *
 * Pipeline: grayscale -> blur -> Canny (auto-thresholded via Otsu) ->
 * morphological close -> findContours. Selection is delegated to the pure
 * `pickContourIndex` policy — the largest contour that does NOT touch the frame
 * border (the image's own border was always the largest 4-gon, so the old
 * "biggest wins" rule returned the whole frame). The chosen contour is then
 * force-fit to four corners: approximate the convex hull to exactly four points
 * (binary-searching epsilon), falling back to the minimum-area rectangle.
 * Returns null only when no interior contour survives or the fit is degenerate
 * — the caller then falls back to the full frame.
 */
function detectQuad(cv: CvNamespace, imageData: ImageData): Quad | null {
  const allocated: unknown[] = []
  // Register each OpenCV object the instant it's allocated, so an exception in a
  // later allocation still frees the earlier ones (no WASM-heap leak).
  const track = <T>(value: T): T => {
    allocated.push(value)
    return value
  }
  const width = imageData.width
  const height = imageData.height
  const minAreaRatio = 0.1
  const minArea = width * height * minAreaRatio

  try {
    const src = track(cv.matFromImageData(imageData))
    const gray = track(new cv.Mat())
    const otsuOut = track(new cv.Mat()) // Otsu's binary output, discarded
    const edges = track(new cv.Mat())
    const ksize = track(new cv.Size(5, 5))
    const closeKernel = track(
      cv.getStructuringElement(cv.MORPH_RECT, track(new cv.Size(9, 9))),
    )
    const contours = track(new cv.MatVector())
    const hierarchy = track(new cv.Mat())

    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY)
    cv.GaussianBlur(gray, gray, ksize, 0, 0, cv.BORDER_DEFAULT)
    // Auto-Canny: derive the thresholds from an Otsu split so they adapt to the
    // scene's lighting instead of the old fixed 75/200. Fall back to a mid
    // threshold if the build returns no Otsu value.
    const otsu: unknown = cv.threshold(
      gray,
      otsuOut,
      0,
      255,
      cv.THRESH_BINARY + cv.THRESH_OTSU,
    )
    const t = typeof otsu === 'number' && otsu > 0 ? otsu : 127
    cv.Canny(gray, edges, 0.66 * t, 1.33 * t)
    // Close small gaps so the document's outline becomes one continuous contour.
    cv.morphologyEx(edges, edges, cv.MORPH_CLOSE, closeKernel)
    cv.findContours(edges, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE)

    // Descriptors for contours clearing the area floor. Their Mats are read and
    // freed here; the chosen contour is re-acquired for the force-fit below.
    const candidates: ContourCandidate[] = []
    const contourIndexFor: number[] = []
    for (let i = 0; i < contours.size(); i += 1) {
      const contour = contours.get(i)
      try {
        if (cv.contourArea(contour) < minArea) continue
        const points = contourPoints(contour)
        candidates.push({ points, area: polygonArea(points) })
        contourIndexFor.push(i)
      } finally {
        dispose(contour)
      }
    }

    const chosen = pickContourIndex(candidates, { width, height, minAreaRatio })
    if (chosen < 0) return null
    const contour = track(contours.get(contourIndexFor[chosen]))

    // Force-fit: approximate the convex hull to exactly four points.
    const hull = track(new cv.Mat())
    cv.convexHull(contour, hull, false, true)
    const peri = cv.arcLength(hull, true)
    const approx = track(new cv.Mat())
    let lo = peri * 0.002
    let hi = peri * 0.2
    for (let it = 0; it < 10; it += 1) {
      const eps = (lo + hi) / 2
      cv.approxPolyDP(hull, approx, eps, true)
      if (approx.rows === 4) {
        const quad = orderCorners(contourPoints(approx))
        return isConvex(quad) ? quad : null
      }
      if (approx.rows > 4) lo = eps // too many points: merge harder
      else hi = eps // too few: merge less
    }

    // Couldn't settle on four via approximation -> minimum-area rectangle.
    const quad = orderCorners(rotatedRectCorners(cv.minAreaRect(contour)))
    return isConvex(quad) ? quad : null
  } finally {
    for (const value of allocated) dispose(value)
  }
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

/**
 * Warp `bytes` by its boundary `quad` into a flat, cropped rectangle and encode
 * the result as JPEG. Pure-ish: only mutates/frees the OpenCV objects it creates.
 * Throws on a degenerate quad (or any OpenCV failure) so the caller replies with
 * a graceful error instead of crashing the worker.
 *
 * The destination rectangle is sized by the Quad's edge lengths (see
 * `computeFlatSize`); src corners TL→(0,0), TR→(w,0), BR→(w,h), BL→(0,h).
 */
async function warpDocument(
  bytes: Bytes,
  quad: Quad,
): Promise<{ readonly bytes: Bytes; readonly width: number; readonly height: number }> {
  const cv = cvInstance
  if (!cv) throw new Error('OpenCV.js is not ready')

  const size = computeFlatSize(quad)
  if (!size) throw new Error('Degenerate boundary — corners are collinear or too small')
  const { width, height } = size

  // Decode with EXIF orientation so the Quad (measured against the oriented
  // image) lines up with the pixels we warp.
  const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/jpeg' }), {
    imageOrientation: 'from-image',
  })
  const allocated: unknown[] = []
  // Register each OpenCV object as it's allocated, so an exception in a later
  // step still frees the earlier ones (no WASM-heap leak).
  const track = <T>(value: T): T => {
    allocated.push(value)
    return value
  }
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
    const ctx2d = canvas.getContext('2d')
    if (!ctx2d) throw new Error('offscreen 2d context unavailable')
    ctx2d.drawImage(bitmap, 0, 0)
    const imageData = ctx2d.getImageData(0, 0, bitmap.width, bitmap.height)

    const src = track(cv.matFromImageData(imageData))
    const warped = track(new cv.Mat())
    const srcTri = track(
      cv.matFromArray(4, 1, cv.CV_32FC2, [
        quad[0].x,
        quad[0].y,
        quad[1].x,
        quad[1].y,
        quad[2].x,
        quad[2].y,
        quad[3].x,
        quad[3].y,
      ]),
    )
    const dstTri = track(
      cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, width, 0, width, height, 0, height]),
    )
    const matrix = track(cv.getPerspectiveTransform(srcTri, dstTri))
    const dsize = track(new cv.Size(width, height))
    cv.warpPerspective(src, warped, matrix, dsize)

    // Encode the RGBA result to JPEG. matFromImageData is RGBA and warpPerspective
    // preserves it, so the Mat maps straight onto an ImageData. We use the
    // worker's OffscreenCanvas rather than cv.imencode (which @techstark/opencv-js
    // exposes at runtime but leaves untyped).
    const out = new OffscreenCanvas(width, height)
    const outCtx = out.getContext('2d')
    if (!outCtx) throw new Error('offscreen 2d context unavailable')
    outCtx.putImageData(new ImageData(new Uint8ClampedArray(warped.data), width, height), 0, 0)
    const blob = await out.convertToBlob({ type: 'image/jpeg', quality: 0.92 })
    const flatBytes = new Uint8Array(await blob.arrayBuffer())
    return { bytes: flatBytes, width, height }
  } finally {
    for (const value of allocated) dispose(value)
    bitmap.close()
  }
}

// --- enhancement ------------------------------------------------------------

/** An RGBA pixel buffer with its dimensions — the output shape of an enhancer. */
interface EnhancedPixels {
  readonly width: number
  readonly height: number
  readonly data: Uint8ClampedArray<ArrayBuffer>
}

/**
 * Color enhancement: a real tonal pass on the flat color image (not a no-op).
 * Boosts saturation and normalizes the luminance contrast for a crisp, vivid
 * look. Pure-ish: only mutates/frees the OpenCV objects it creates. Works in
 * HSV so hue is preserved while S/V are reshaped.
 *
 * We move to RGB (dropping alpha) → HSV, split, reshape S and V, merge back to
 * RGB, then re-attach a constant alpha=255 by hand (OpenCV's RGB→RGBA channel
 * add leaves alpha ambiguous, so the explicit copy is the reliable path).
 */
function enhanceColor(cv: CvNamespace, imageData: ImageData): EnhancedPixels {
  const width = imageData.width
  const height = imageData.height
  const allocated: unknown[] = []
  const track = <T>(value: T): T => {
    allocated.push(value)
    return value
  }
  try {
    const src = track(cv.matFromImageData(imageData))
    const rgb = track(new cv.Mat())
    cv.cvtColor(src, rgb, cv.COLOR_RGBA2RGB)
    const hsv = track(new cv.Mat())
    cv.cvtColor(rgb, hsv, cv.COLOR_RGB2HSV)

    const parts = track(new cv.MatVector())
    cv.split(hsv, parts)
    const h = track(parts.get(0))
    const s = track(parts.get(1))
    const v = track(parts.get(2))

    // Saturation boost → a vivid, clean color page.
    const sBoost = track(new cv.Mat())
    cv.convertScaleAbs(s, sBoost, 1.3, 0)
    // Contrast normalization on luminance. @techstark/opencv-js's TS types
    // declare functions its runtime build omits — createCLAHE is absent in this
    // build (a class/factory binding), so prefer the plain free function
    // equalizeHist but feature-check it and fall back to a linear stretch.
    // convertScaleAbs is already known to be present (it runs above).
    const vOut = track(new cv.Mat())
    if (typeof cv.equalizeHist === 'function') {
      cv.equalizeHist(v, vOut)
    } else {
      cv.convertScaleAbs(v, vOut, 1.2, 0)
    }

    const merged = track(new cv.MatVector())
    merged.push_back(h)
    merged.push_back(sBoost)
    merged.push_back(vOut)
    const hsv2 = track(new cv.Mat())
    cv.merge(merged, hsv2)
    const rgb2 = track(new cv.Mat())
    cv.cvtColor(hsv2, rgb2, cv.COLOR_HSV2RGB)

    // rgb2 is CV_8UC3; pack into RGBA with opaque alpha for ImageData.
    const src3 = rgb2.data
    const rgba = new Uint8ClampedArray(width * height * 4)
    for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) {
      rgba[i] = src3[j]
      rgba[i + 1] = src3[j + 1]
      rgba[i + 2] = src3[j + 2]
      rgba[i + 3] = 255
    }
    return { width, height, data: rgba }
  } finally {
    for (const value of allocated) dispose(value)
  }
}

/** Smallest odd integer in [3, 75] near `target` — adaptiveThreshold needs an odd block size > 1. */
function oddBlockSize(target: number): number {
  const clamped = Math.min(75, Math.max(3, Math.round(target)))
  return clamped % 2 === 0 ? clamped + 1 : clamped
}

/**
 * Broadcast a single-channel (CV_8UC1) buffer to RGBA with opaque alpha — the
 * shared output step for the grayscale and B&W enhancers, which both settle on a
 * one-channel result. Pure: allocates a fresh buffer, touches nothing else.
 */
function broadcastGrayToRgba(
  gray: Uint8Array,
  width: number,
  height: number,
): Uint8ClampedArray<ArrayBuffer> {
  const rgba = new Uint8ClampedArray(width * height * 4)
  for (let i = 0, j = 0; i < rgba.length; i += 4, j += 1) {
    const v = gray[j]
    rgba[i] = v
    rgba[i + 1] = v
    rgba[i + 2] = v
    rgba[i + 3] = 255
  }
  return rgba
}

/**
 * Grayscale enhancement: desaturate the flat image and stretch its luminance
 * contrast for a clean, legible gray scan. Pure-ish: only mutates/frees the
 * OpenCV objects it creates. Mirrors the color pass's contrast approach
 * (`equalizeHist` when the build exposes it, else a fixed-gain fallback).
 */
function enhanceGrayscale(cv: CvNamespace, imageData: ImageData): EnhancedPixels {
  const width = imageData.width
  const height = imageData.height
  const allocated: unknown[] = []
  const track = <T>(value: T): T => {
    allocated.push(value)
    return value
  }
  try {
    const src = track(cv.matFromImageData(imageData))
    const gray = track(new cv.Mat())
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY)
    const out = track(new cv.Mat())
    if (typeof cv.equalizeHist === 'function') {
      cv.equalizeHist(gray, out)
    } else {
      cv.convertScaleAbs(gray, out, 1.2, 0)
    }
    // out is CV_8UC1; broadcast the single channel to RGBA with opaque alpha.
    return { width, height, data: broadcastGrayToRgba(out.data, width, height) }
  } finally {
    for (const value of allocated) dispose(value)
  }
}

/**
 * B&W enhancement: adaptive (local) threshold for the crisp, thresholded
 * "scanned document" look that stays robust to uneven lighting. Pure-ish: only
 * mutates/frees the OpenCV objects it creates. The block size scales with the
 * image (≈ 1/30 of the shorter side) so it suits both small and large flats; a
 * positive C trims each local mean so dark text reliably drops below threshold.
 */
function enhanceBw(cv: CvNamespace, imageData: ImageData): EnhancedPixels {
  const width = imageData.width
  const height = imageData.height
  const allocated: unknown[] = []
  const track = <T>(value: T): T => {
    allocated.push(value)
    return value
  }
  try {
    const src = track(cv.matFromImageData(imageData))
    const gray = track(new cv.Mat())
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY)
    const bw = track(new cv.Mat())
    const blockSize = oddBlockSize(Math.min(width, height) / 30)
    cv.adaptiveThreshold(
      gray,
      bw,
      255,
      cv.ADAPTIVE_THRESH_GAUSSIAN_C,
      cv.THRESH_BINARY,
      blockSize,
      10,
    )
    // bw is CV_8UC1; broadcast the single channel to RGBA with opaque alpha.
    return { width, height, data: broadcastGrayToRgba(bw.data, width, height) }
  } finally {
    for (const value of allocated) dispose(value)
  }
}

/**
 * Enhance the flat image `bytes` by its `mode` and encode the result as JPEG.
 * The input is the flat (a synthetic warp output), so there are no EXIF /
 * orientation concerns — unlike detect/warp, we decode the JPEG as-is.
 * Throws on an OpenCV failure or an unsupported mode so the caller replies with
 * a graceful error instead of crashing the worker.
 */
async function enhanceDocument(
  bytes: Bytes,
  mode: EnhanceMode,
): Promise<{ readonly bytes: Bytes; readonly width: number; readonly height: number }> {
  const cv = cvInstance
  if (!cv) throw new Error('OpenCV.js is not ready')

  const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/jpeg' }))
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
    const ctx2d = canvas.getContext('2d')
    if (!ctx2d) throw new Error('offscreen 2d context unavailable')
    ctx2d.drawImage(bitmap, 0, 0)
    const imageData = ctx2d.getImageData(0, 0, bitmap.width, bitmap.height)

    let pixels: EnhancedPixels
    switch (mode) {
      case 'color':
        pixels = enhanceColor(cv, imageData)
        break
      case 'grayscale':
        pixels = enhanceGrayscale(cv, imageData)
        break
      case 'bw':
        pixels = enhanceBw(cv, imageData)
        break
      default:
        throw new Error(`enhance mode "${mode}" is not supported`)
    }

    const out = new OffscreenCanvas(pixels.width, pixels.height)
    const outCtx = out.getContext('2d')
    if (!outCtx) throw new Error('offscreen 2d context unavailable')
    outCtx.putImageData(new ImageData(pixels.data, pixels.width, pixels.height), 0, 0)
    const blob = await out.convertToBlob({ type: 'image/jpeg', quality: 0.92 })
    const enhBytes = new Uint8Array(await blob.arrayBuffer())
    return { bytes: enhBytes, width: pixels.width, height: pixels.height }
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

async function handleWarp(
  msg: Extract<CvRequest, { readonly type: 'warp' }>,
): Promise<void> {
  try {
    const { bytes, width, height } = await warpDocument(msg.bytes, msg.quad)
    // Transfer the result buffer (zero-copy) — the worker is done with it.
    ctx.postMessage(
      { type: 'warp', id: msg.id, ok: true, bytes, width, height } satisfies CvResponse,
      [bytes.buffer],
    )
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : String(err)
    ctx.postMessage({ type: 'warp', id: msg.id, ok: false, error: error || 'flatten failed' } satisfies CvResponse)
  }
}

async function handleEnhance(
  msg: Extract<CvRequest, { readonly type: 'enhance' }>,
): Promise<void> {
  try {
    const { bytes, width, height } = await enhanceDocument(msg.bytes, msg.mode)
    // Transfer the result buffer (zero-copy) — the worker is done with it.
    ctx.postMessage(
      { type: 'enhance', id: msg.id, ok: true, bytes, width, height } satisfies CvResponse,
      [bytes.buffer],
    )
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : String(err)
    ctx.postMessage({ type: 'enhance', id: msg.id, ok: false, error: error || 'enhance failed' } satisfies CvResponse)
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
    case 'warp':
      void handleWarp(msg)
      break
    case 'enhance':
      void handleEnhance(msg)
      break
    default:
      // Unknown message — ignore for now.
      break
  }
}
