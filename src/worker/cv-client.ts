import type { Bytes, EnhanceMode, Quad } from '../types'
import type { CvRequest, CvResponse } from './protocol'

/**
 * Main-thread client for the CV worker. Lazily spawns a single module worker,
 * exposes `ping` (worker health), `ready` (OpenCV.js readiness), `detect`
 * (document boundary), `warp` (perspective correction / flatten), and `enhance`
 * (tonal enhancement of a flat image). This is the service the UI talks to; the
 * worker itself is an implementation detail.
 *
 * Messages are routed by `type`; detect/warp/enhance responses are correlated
 * to requests by `id` so overlapping calls can't be confused.
 */

// The `ready` variant of the protocol response, without its discriminator —
// derived from the protocol so it stays the single source of truth.
type ReadyPayload = Omit<Extract<CvResponse, { readonly type: 'ready' }>, 'type'>

/** Result of a detect call: either a boundary Quad (in source-pixel coords) or an error. */
export type DetectOutcome =
  | { readonly ok: true; readonly quad: Quad; readonly width: number; readonly height: number }
  | { readonly ok: false; readonly error: string }

/** Result of a warp call: the flattened JPEG bytes + dims, or an error. */
export type WarpOutcome =
  | { readonly ok: true; readonly bytes: Bytes; readonly width: number; readonly height: number }
  | { readonly ok: false; readonly error: string }

/** Result of an enhance call: the enhanced JPEG bytes + dims, or an error. */
export type EnhanceOutcome =
  | { readonly ok: true; readonly bytes: Bytes; readonly width: number; readonly height: number }
  | { readonly ok: false; readonly error: string }

let worker: Worker | null = null
// Pings are answered in order (one pong per ping), so a FIFO tolerates overlap.
const pingQueue: Array<() => void> = []
let readyResult: ReadyPayload | null = null
let readyResolver: ((r: ReadyPayload) => void) | null = null
let readyPromise: Promise<{ readonly version: string | null }> | null = null
let detectCounter = 0
const detectWaiters = new Map<number, (outcome: DetectOutcome) => void>()
let warpCounter = 0
const warpWaiters = new Map<number, (outcome: WarpOutcome) => void>()
let enhanceCounter = 0
const enhanceWaiters = new Map<number, (outcome: EnhanceOutcome) => void>()

function handleResponse(msg: CvResponse): void {
  switch (msg.type) {
    case 'pong': {
      const resolve = pingQueue.shift()
      if (resolve) resolve()
      return
    }
    case 'ready': {
      readyResult = { ok: msg.ok, version: msg.version, error: msg.error }
      if (readyResolver) {
        const resolve = readyResolver
        readyResolver = null
        resolve(readyResult)
      }
      return
    }
    case 'detect': {
      const settle = detectWaiters.get(msg.id)
      if (settle) {
        detectWaiters.delete(msg.id)
        settle(
          msg.ok
            ? { ok: true, quad: msg.quad, width: msg.width, height: msg.height }
            : { ok: false, error: msg.error },
        )
      }
      return
    }
    case 'warp': {
      const settle = warpWaiters.get(msg.id)
      if (settle) {
        warpWaiters.delete(msg.id)
        settle(
          msg.ok
            ? { ok: true, bytes: msg.bytes, width: msg.width, height: msg.height }
            : { ok: false, error: msg.error },
        )
      }
      return
    }
    case 'enhance': {
      const settle = enhanceWaiters.get(msg.id)
      if (settle) {
        enhanceWaiters.delete(msg.id)
        settle(
          msg.ok
            ? { ok: true, bytes: msg.bytes, width: msg.width, height: msg.height }
            : { ok: false, error: msg.error },
        )
      }
      return
    }
    default:
      return
  }
}

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./cv.worker.ts', import.meta.url), { type: 'module' })
    worker.addEventListener('message', (e: MessageEvent<CvResponse>) => handleResponse(e.data))
    // If the worker crashes or fails to load, fail in-flight callers instead of
    // hanging forever (the message listener will never fire).
    worker.addEventListener('error', () => {
      for (const settle of detectWaiters.values()) settle({ ok: false, error: 'CV worker crashed' })
      detectWaiters.clear()
      for (const settle of warpWaiters.values()) settle({ ok: false, error: 'CV worker crashed' })
      warpWaiters.clear()
      for (const settle of enhanceWaiters.values()) settle({ ok: false, error: 'CV worker crashed' })
      enhanceWaiters.clear()
      for (const resolve of pingQueue) resolve()
      pingQueue.length = 0
      if (!readyResult) {
        readyResult = { ok: false, version: null, error: 'CV worker crashed' }
        if (readyResolver) {
          const resolve = readyResolver
          readyResolver = null
          resolve(readyResult)
        }
      }
    })
  }
  return worker
}

/** Resolves once OpenCV.js has initialised in the worker (cached); rejects on failure. */
function awaitReady(): Promise<{ readonly version: string | null }> {
  if (!readyPromise) {
    getWorker() // spawn the worker so it starts loading and can notify us
    readyPromise = new Promise<{ readonly version: string | null }>((resolve, reject) => {
      const settle = (r: ReadyPayload): void => {
        if (r.ok) resolve({ version: r.version })
        else reject(new Error(r.error ?? 'OpenCV.js failed to load'))
      }
      if (readyResult) {
        settle(readyResult)
        return
      }
      readyResolver = settle
    })
  }
  return readyPromise
}

export const cvClient = {
  /** Health check — proves the worker is alive, independent of OpenCV. */
  ping(): Promise<void> {
    const w = getWorker()
    return new Promise<void>((resolve) => {
      pingQueue.push(resolve)
      w.postMessage({ type: 'ping' } satisfies CvRequest)
    })
  },

  /** Resolves once OpenCV.js has initialised in the worker; rejects on failure. */
  ready: awaitReady,

  /**
   * Detect the document boundary in `bytes` (a JPEG). Awaits OpenCV readiness
   * first. Returns the Quad in source-pixel coords, or an error outcome.
   */
  detect(bytes: Bytes): Promise<DetectOutcome> {
    return awaitReady().then(() => {
      const w = getWorker()
      const id = detectCounter++
      return new Promise<DetectOutcome>((resolve) => {
        detectWaiters.set(id, resolve)
        w.postMessage({ type: 'detect', id, bytes } satisfies CvRequest)
      })
    })
  },

  /**
   * Perspective-correct ("flatten") `bytes` (a JPEG) by its boundary `quad` into
   * a cropped rectangle. Awaits OpenCV readiness first. Returns the flattened
   * JPEG bytes + dims, or an error outcome (e.g. a degenerate quad).
   */
  warp(bytes: Bytes, quad: Quad): Promise<WarpOutcome> {
    return awaitReady().then(() => {
      const w = getWorker()
      const id = warpCounter++
      return new Promise<WarpOutcome>((resolve) => {
        warpWaiters.set(id, resolve)
        w.postMessage({ type: 'warp', id, bytes, quad } satisfies CvRequest)
      })
    })
  },

  /**
   * Enhance a flat image `bytes` (a JPEG) by its `mode` — the "clean scan" tonal
   * pass. Awaits OpenCV readiness first. Returns the enhanced JPEG bytes + dims,
   * or an error outcome. The input is a flat (synthetic), so no orientation pass.
   */
  enhance(bytes: Bytes, mode: EnhanceMode): Promise<EnhanceOutcome> {
    return awaitReady().then(() => {
      const w = getWorker()
      const id = enhanceCounter++
      return new Promise<EnhanceOutcome>((resolve) => {
        enhanceWaiters.set(id, resolve)
        w.postMessage({ type: 'enhance', id, bytes, mode } satisfies CvRequest)
      })
    })
  },
}
