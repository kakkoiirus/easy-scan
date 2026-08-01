/// <reference lib="webworker" />

import type { CvRequest, CvResponse } from './protocol'

/**
 * CV Web Worker (ADR-0002). All OpenCV.js work runs here, never on the main
 * thread, so capture/adjust UI stays responsive during detection/correction.
 *
 * M0: only proves the messaging wiring (ping -> pong).
 * M2: load OpenCV.js and handle `detect` (grayscale -> blur -> Canny ->
 *      findContours -> largest quad), returning a Quad.
 * M3/M4: handle `warp` (perspective correction) and `enhance` (color/gray/B&W).
 */

const ctx = self as unknown as DedicatedWorkerGlobalScope

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
