// Message protocol between the main thread and the CV Web Worker (ADR-0002).
// Discriminated unions on `type`.
//
// - `ping`/`pong`: worker health, independent of OpenCV.
// - `ready`: worker's ONE-SHOT notification that OpenCV.js initialised (ok or error).
// - `detect`: send a JPEG, get back the document boundary Quad (or an error).
// - `warp`: send a JPEG + its boundary Quad, get back the flattened JPEG bytes
//   and its dimensions (or an error).
// - `enhance`: send a flat JPEG + a mode, get back the enhanced JPEG bytes and
//   its dimensions (or an error). `id` correlates each response to its request.

import type { Bytes, EnhanceMode, Quad } from '../types'

export type CvRequest =
  | { readonly type: 'ping' }
  | { readonly type: 'detect'; readonly id: number; readonly bytes: Bytes }
  | { readonly type: 'warp'; readonly id: number; readonly bytes: Bytes; readonly quad: Quad }
  | { readonly type: 'enhance'; readonly id: number; readonly bytes: Bytes; readonly mode: EnhanceMode }

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
  | {
      readonly type: 'warp'
      readonly id: number
      readonly ok: true
      readonly bytes: Bytes
      readonly width: number
      readonly height: number
    }
  | { readonly type: 'warp'; readonly id: number; readonly ok: false; readonly error: string }
  | {
      readonly type: 'enhance'
      readonly id: number
      readonly ok: true
      readonly bytes: Bytes
      readonly width: number
      readonly height: number
    }
  | { readonly type: 'enhance'; readonly id: number; readonly ok: false; readonly error: string }
