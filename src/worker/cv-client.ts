import type { CvRequest, CvResponse } from './protocol'

/**
 * Main-thread client for the CV worker. Lazily spawns a single module worker,
 * exposes `ping` (worker health) and `ready` (OpenCV.js readiness), and will
 * carry the detect/warp requests added in later tickets. This is the service
 * the UI talks to; the worker itself is an implementation detail.
 *
 * Messages are routed by `type` so ping and the unsolicited ready notification
 * can't be confused for each other.
 */

// The `ready` variant of the protocol response, without its discriminator —
// derived from the protocol so it stays the single source of truth.
type ReadyPayload = Omit<Extract<CvResponse, { readonly type: 'ready' }>, 'type'>

let worker: Worker | null = null
// Pings are answered in order (one pong per ping), so a FIFO tolerates any
// overlap instead of dropping an earlier caller.
const pingQueue: Array<() => void> = []
let readyResult: ReadyPayload | null = null
let readyResolver: ((r: ReadyPayload) => void) | null = null
let readyPromise: Promise<{ readonly version: string | null }> | null = null

function handleResponse(msg: CvResponse): void {
  if (msg.type === 'pong') {
    const resolve = pingQueue.shift()
    if (resolve) resolve()
    return
  }
  // msg.type === 'ready'
  readyResult = { ok: msg.ok, version: msg.version, error: msg.error }
  if (readyResolver) {
    const resolve = readyResolver
    readyResolver = null
    resolve(readyResult)
  }
}

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./cv.worker.ts', import.meta.url), { type: 'module' })
    worker.addEventListener('message', (e: MessageEvent<CvResponse>) => handleResponse(e.data))
  }
  return worker
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

  /**
   * Resolves once OpenCV.js has initialised in the worker. Safe to call
   * repeatedly — the result is cached. Detect/warp callers should await this
   * before issuing CV work. Rejects if OpenCV failed to load.
   */
  ready(): Promise<{ readonly version: string | null }> {
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
  },
}
