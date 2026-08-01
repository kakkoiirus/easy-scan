import type { Bytes } from '../types'

/**
 * Imperative camera service (lives outside React's render cycle — see the
 * architecture note in CLAUDE.md). The UI subscribes to status via
 * `useSyncExternalStore`; the heavy 60fps-ish work (stream + capture) never
 * touches React's reconciliation.
 *
 * Camera I/O (`getUserMedia`, `ImageCapture`, the `<video>`) is browser/
 * hardware integration and is verified manually — localhost in dev is a secure
 * context, HTTPS in production, a real device for phone behaviour.
 */

/** Lifecycle status of the camera (a small state machine). */
export type CameraStatus = 'idle' | 'starting' | 'streaming' | 'denied' | 'error'

/** A captured still: JPEG bytes plus its real, EXIF-oriented dimensions. */
export interface CapturedFrame {
  readonly bytes: Bytes
  readonly width: number
  readonly height: number
}

export interface CameraController {
  /** Acquire a stream and attach it to `<video>`; resolves once streaming or errored. */
  readonly start: (video: HTMLVideoElement) => Promise<void>
  /** Release the stream, detach `<video>`, return to idle. Safe to call anytime. */
  readonly stop: () => void
  /** Capture a full-resolution, right-side-up still. Requires `streaming`. */
  readonly capture: () => Promise<CapturedFrame>
  /** Current status (for `useSyncExternalStore` getSnapshot). */
  readonly getStatus: () => CameraStatus
  /** Subscribe to status changes (for `useSyncExternalStore`). */
  readonly subscribe: (cb: () => void) => () => void
}

// --- State (module-level singleton, like `cvClient`) ------------------------

let status: CameraStatus = 'idle'
let stream: MediaStream | null = null
let videoEl: HTMLVideoElement | null = null
/** Bumped on every start/stop; an in-flight acquire whose generation no longer
 *  matches has lost the race and must release its stream without touching state. */
let generation = 0
const listeners = new Set<() => void>()

function setStatus(next: CameraStatus): void {
  if (status === next) return
  status = next
  for (const listener of listeners) listener()
}

function stopTracks(s: MediaStream): void {
  for (const track of s.getTracks()) track.stop()
}

function releaseStream(): void {
  if (stream) {
    stopTracks(stream)
    stream = null
  }
}

// ImageCapture (Chrome/Edge) is absent from TS's lib.dom.d.ts and from Safari;
// feature-detect it rather than declaring a global that may already exist.
type ImageCaptureLike = { new (track: MediaStreamTrack): { takePhoto: () => Promise<Blob> } }
function getImageCapture(): ImageCaptureLike | undefined {
  return (globalThis as { ImageCapture?: ImageCaptureLike }).ImageCapture
}

function isPermissionError(err: unknown): boolean {
  return (
    err instanceof DOMException && (err.name === 'NotAllowedError' || err.name === 'SecurityError')
  )
}

async function start(video: HTMLVideoElement): Promise<void> {
  // Tear down anything currently alive before (re)starting.
  releaseStream()
  if (videoEl && videoEl !== video) videoEl.srcObject = null

  const gen = ++generation
  videoEl = video
  setStatus('starting')

  // Insecure context (no secure origin) — can't access the camera at all.
  if (!navigator.mediaDevices?.getUserMedia) {
    if (gen === generation) setStatus('error')
    return
  }

  try {
    const acquired = await navigator.mediaDevices.getUserMedia({
      // `ideal` (not `exact`) so desktop webcams and phones without a back camera still work.
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 3840 } },
      audio: false,
    })

    // Lost the race (user left mid-acquire): release immediately, leave state untouched.
    if (gen !== generation) {
      stopTracks(acquired)
      return
    }

    stream = acquired
    video.srcObject = acquired
    setStatus('streaming')
    // autoPlay + muted + playsInline starts playback, but nudging play() is more
    // reliable across browsers (and survives the dev StrictMode stop/start dance).
    void video.play().catch(() => {})
  } catch (err) {
    // Left while the permission prompt was still open: nothing acquired, stay quiet.
    if (gen !== generation) return
    setStatus(isPermissionError(err) ? 'denied' : 'error')
  }
}

function stop(): void {
  generation += 1 // invalidate any in-flight start()
  releaseStream()
  if (videoEl) {
    videoEl.srcObject = null
    videoEl = null
  }
  setStatus('idle')
}

async function capture(): Promise<CapturedFrame> {
  if (status !== 'streaming' || !stream || !videoEl) {
    throw new Error('camera is not streaming')
  }
  const [track] = stream.getVideoTracks()
  const ImageCapture = getImageCapture()

  // Prefer full-sensor resolution via ImageCapture (a real photo, EXIF included).
  if (track && ImageCapture) {
    try {
      return await frameFromBlob(await new ImageCapture(track).takePhoto())
    } catch {
      // ImageCapture unsupported/unavailable on this track → canvas fallback below.
    }
  }
  return frameFromVideo(videoEl)
}

/** Decode a photo Blob to its real, auto-oriented dimensions (from EXIF). */
async function frameFromBlob(blob: Blob): Promise<CapturedFrame> {
  const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' })
  const { width, height } = bitmap
  bitmap.close()
  return { bytes: new Uint8Array(await blob.arrayBuffer()), width, height }
}

/** Canvas fallback at the video's intrinsic size (no EXIF orientation available). */
async function frameFromVideo(video: HTMLVideoElement): Promise<CapturedFrame> {
  const { videoWidth: width, videoHeight: height } = video
  if (!width || !height) throw new Error('video frame not ready')

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2d context unavailable')
  ctx.drawImage(video, 0, 0, width, height)

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('toBlob failed'))),
      'image/jpeg',
      0.9,
    )
  })
  return { bytes: new Uint8Array(await blob.arrayBuffer()), width, height }
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

function getStatus(): CameraStatus {
  return status
}

export const cameraController: CameraController = {
  start,
  stop,
  capture,
  getStatus,
  subscribe,
}
