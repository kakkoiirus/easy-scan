// Message protocol between the main thread and the CV Web Worker (ADR-0002).
// Discriminated unions on `type`.
//
// - `ping`/`pong`: worker health, independent of OpenCV.
// - `ready`: worker's ONE-SHOT notification that OpenCV.js initialised (ok or error).
// - `detect`: send a JPEG, get back the document boundary Quad (or an error).
//   `id` correlates the response to the request.

import type { Bytes, Quad } from '../types'

export type CvRequest =
  | { readonly type: 'ping' }
  | { readonly type: 'detect'; readonly id: number; readonly bytes: Bytes }

export type CvResponse =
  | { readonly type: 'pong' }
  | {
      readonly type: 'ready'
      readonly ok: boolean
      readonly version: string | null
      readonly error: string | null
    }
  | {
      readonly type: 'detect'
      readonly id: number
      readonly ok: true
      readonly quad: Quad
      readonly width: number
      readonly height: number
    }
  | { readonly type: 'detect'; readonly id: number; readonly ok: false; readonly error: string }
