// Message protocol between the main thread and the CV Web Worker (ADR-0002).
// Discriminated unions on `type`.
//
// `ping`/`pong` prove the messaging wiring (worker alive, independent of
// OpenCV). `ready` is the worker's ONE-SHOT notification that OpenCV.js has
// finished initialising — `ok: true` with a build version, or `ok: false` with
// an error. Detect/warp requests are added in later tickets (M2/M3).

export type CvRequest = { readonly type: 'ping' }

export type CvResponse =
  | { readonly type: 'pong' }
  | {
      readonly type: 'ready'
      readonly ok: boolean
      readonly version: string | null
      readonly error: string | null
    }
