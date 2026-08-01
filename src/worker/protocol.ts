// Message protocol between the main thread and the CV Web Worker (ADR-0002).
// Discriminated unions on `type`. Expanded at M2+ (detect / warp / enhance).

export type CvRequest = { readonly type: 'ping' }

export type CvResponse = { readonly type: 'pong' }
