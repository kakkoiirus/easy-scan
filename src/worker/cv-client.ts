import type { CvRequest, CvResponse } from './protocol'

/**
 * Main-thread client for the CV worker. Lazily spawns a single module worker
 * and wraps request/response in promises. This is the service the UI calls;
 * the worker itself is an implementation detail.
 */

let worker: Worker | null = null

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./cv.worker.ts', import.meta.url), { type: 'module' })
  }
  return worker
}

function request(req: CvRequest): Promise<CvResponse> {
  const w = getWorker()
  return new Promise((resolve) => {
    const onMessage = (e: MessageEvent<CvResponse>) => {
      w.removeEventListener('message', onMessage)
      resolve(e.data)
    }
    w.addEventListener('message', onMessage)
    w.postMessage(req)
  })
}

export const cvClient = {
  /** Health check — proves the worker is alive and wired. */
  ping(): Promise<void> {
    return request({ type: 'ping' }).then((res) => {
      if (res.type !== 'pong') throw new Error('unexpected worker response')
    })
  },
}
