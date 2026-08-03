import { Button, Loader, Stack, Text } from '@mantine/core'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import { cameraController, type CapturedFrame } from '../camera/camera-controller'
import { cvClient } from '../worker/cv-client'
import { createSinglePageDocument } from '../storage/useDocuments'
import type { Point, Quad } from '../types'

interface CameraScreenProps {
  onBack: () => void
}

/** A captured frame, its object URL, and its detected boundary.
 *  `quad` is null while detecting or if detection found nothing usable. */
interface Review {
  readonly url: string
  readonly frame: CapturedFrame
  readonly quad: Quad | null
  readonly detecting: boolean
}

export function CameraScreen({ onBack }: CameraScreenProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const status = useSyncExternalStore(
    cameraController.subscribe,
    cameraController.getStatus,
    cameraController.getStatus,
  )
  const [review, setReview] = useState<Review | null>(null)
  const [capturing, setCapturing] = useState(false)
  const [saving, setSaving] = useState(false)

  // Permission requested only on mount; start/stop are generation-guarded (no leaks).
  useEffect(() => {
    if (videoRef.current) void cameraController.start(videoRef.current)
    return () => cameraController.stop()
  }, [])

  // Revoke the review object URL when it changes or on unmount. Keyed on the URL
  // so updating only the quad (same URL) doesn't revoke the still-displayed image.
  useEffect(() => {
    const url = review?.url
    if (!url) return
    return () => URL.revokeObjectURL(url)
  }, [review?.url])

  async function handleShutter(): Promise<void> {
    setCapturing(true)
    try {
      const frame = await cameraController.capture()
      const url = URL.createObjectURL(new Blob([frame.bytes], { type: 'image/jpeg' }))
      setReview({ url, frame, quad: null, detecting: true })
      // Detect the boundary in the worker. On error, leave quad null — Save then
      // stores the full-frame placeholder quad.
      let quad: Quad | null = null
      try {
        const result = await cvClient.detect(frame.bytes)
        quad = result.ok ? result.quad : null
      } catch {
        quad = null
      }
      setReview((r) => (r && r.url === url ? { ...r, quad, detecting: false } : r))
    } catch {
      // Capture failed (e.g. stream ended) — stay in the live preview.
    } finally {
      setCapturing(false)
    }
  }

  async function handleSave(): Promise<void> {
    if (!review) return
    setSaving(true)
    try {
      await createSinglePageDocument(
        `Документ · ${new Date().toLocaleTimeString()}`,
        review.frame,
        review.quad ?? undefined,
      )
      onBack() // unmount revokes the review URL and stops the camera (no leaks)
    } catch {
      // Persist failed — stay on review so the user can retry or cancel.
      setSaving(false)
    }
  }

  const reviewing = review !== null
  const detecting = review?.detecting ?? false

  return (
    <div className="camera">
      {/* Always mounted so Retake returns to a live preview instantly (no restart). */}
      <video ref={videoRef} className="camera__video" autoPlay muted playsInline />

      {review && (
        // One SVG whose viewBox is the image's pixels: photo + quad share the same
        // user space, so the overlay aligns with no measuring.
        <svg
          className="camera__review"
          viewBox={`0 0 ${review.frame.width} ${review.frame.height}`}
          preserveAspectRatio="xMidYMid meet"
        >
          <image href={review.url} x={0} y={0} width={review.frame.width} height={review.frame.height} />
          {review.quad && <QuadOverlay quad={review.quad} span={review.frame} />}
        </svg>
      )}

      {detecting && (
        <div className="camera__detecting">
          <Loader size="sm" />
          <Text size="xs">Определение границ…</Text>
        </div>
      )}

      <div className="camera__topbar">
        <Button variant="light" size="xs" color="gray" onClick={onBack}>
          {reviewing ? 'Отмена' : 'Назад'}
        </Button>
      </div>

      {/* Status overlays — never a blank screen. Hidden while reviewing. */}
      {!reviewing && status === 'starting' && (
        <Overlay>
          <Loader />
          <Text size="sm">Запуск камеры…</Text>
        </Overlay>
      )}
      {!reviewing && status === 'denied' && (
        <Overlay>
          <Text fw={600} ta="center">Доступ к камере запрещён</Text>
          <Text size="sm" c="dimmed" ta="center">
            Разрешите доступ в настройках браузера и обновите страницу.
          </Text>
          <Button variant="light" color="gray" onClick={onBack}>
            Назад
          </Button>
        </Overlay>
      )}
      {!reviewing && status === 'error' && (
        <Overlay>
          <Text fw={600} ta="center">Камера недоступна</Text>
          <Text size="sm" c="dimmed" ta="center">
            Возможно, она занята другим приложением или отсутствует.
          </Text>
          <Button variant="light" color="gray" onClick={onBack}>
            Назад
          </Button>
        </Overlay>
      )}

      {/* Controls — shutter while streaming; Save/Retake while reviewing. */}
      {(reviewing || status === 'streaming') && (
        <div className="camera__controls">
          {reviewing ? (
            <Stack align="center" gap="sm">
              <Button size="md" loading={saving} disabled={detecting} onClick={handleSave}>
                Сохранить
              </Button>
              <Button
                variant="subtle"
                color="gray"
                size="xs"
                disabled={saving}
                onClick={() => setReview(null)}
              >
                Переснять
              </Button>
            </Stack>
          ) : (
            <button
              type="button"
              className="camera__shutter"
              aria-label="Сделать снимок"
              disabled={capturing}
              onClick={handleShutter}
            />
          )}
        </div>
      )}
    </div>
  )
}

/** Draws the detected boundary: a translucent fill, an outline, and four corner dots. */
function QuadOverlay({
  quad,
  span,
}: {
  readonly quad: Quad
  readonly span: { readonly width: number; readonly height: number }
}) {
  const points = quad.map((p) => `${p.x},${p.y}`).join(' ')
  const r = Math.max(span.width, span.height) * 0.012
  return (
    <g>
      <polygon points={points} className="camera__quad-shape" />
      {quad.map((p: Point, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={r} className="camera__quad-dot" />
      ))}
    </g>
  )
}

/** Centered overlay with a dimmed backdrop for loading / denied / error states. */
function Overlay({ children }: { readonly children: ReactNode }) {
  return (
    <div className="camera__overlay">
      <Stack align="center" justify="center" gap="sm">
        {children}
      </Stack>
    </div>
  )
}
