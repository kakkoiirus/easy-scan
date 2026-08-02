/// <reference lib="webworker" />

import * as opencv from '@techstark/opencv-js'
import type { CvRequest, CvResponse } from './protocol'

/**
 * CV Web Worker (ADR-0002). All OpenCV.js work runs here, never on the main
 * thread, so capture/adjust UI stays responsive during detection/correction.
 *
 * This ticket (M2/01) just loads OpenCV.js and reports readiness. The worker
 * boots OpenCV the moment it starts and notifies the client exactly once when
 * initialisation succeeds or fails. `ping` keeps working throughout.
 *
 * Later: handle `detect` (M2), `warp` (M3), `enhance` (M4).
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

let notified = false

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

/** Kick off OpenCV.js initialisation; notifies the client on completion. */
function initOpenCV(): void {
  cvThenable
    .then((cv) => {
      notifyReady(true, readVersion(cv), null)
    })
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err)
      notifyReady(false, null, message || 'OpenCV.js failed to initialise')
    })
}

// Start loading immediately; `onmessage` is wired synchronously below so ping
// works even while OpenCV is still initialising.
initOpenCV()

ctx.onmessage = (event: MessageEvent) => {
  const msg = event.data as CvRequest
  switch (msg.type) {
    case 'ping':
      ctx.postMessage({ type: 'pong' } satisfies CvResponse)
      break
    default:
      // Unknown message — ignore for now.
      break
  }
}
