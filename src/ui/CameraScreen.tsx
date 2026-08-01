import { Button, Loader, Stack, Text } from '@mantine/core'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import { cameraController, type CapturedFrame } from '../camera/camera-controller'

interface CameraScreenProps {
  onBack: () => void
}

/** A captured frame plus its object URL for the review overlay. */
interface Review {
  readonly url: string
  readonly frame: CapturedFrame
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

  // Permission is requested only when this screen mounts (not at app launch).
  // start/stop are generation-guarded, so navigating away mid-prompt leaks nothing.
  useEffect(() => {
    if (videoRef.current) void cameraController.start(videoRef.current)
    return () => cameraController.stop()
  }, [])

  // Revoke the review object URL when it changes or on unmount — no leaks.
  useEffect(() => {
    if (!review) return
    return () => URL.revokeObjectURL(review.url)
  }, [review])

  async function handleShutter(): Promise<void> {
    setCapturing(true)
    try {
      const frame = await cameraController.capture()
      const url = URL.createObjectURL(new Blob([frame.bytes], { type: 'image/jpeg' }))
      setReview({ url, frame })
    } catch {
      // Capture failed (e.g. stream ended) — stay in the live preview.
    } finally {
      setCapturing(false)
    }
  }

  const reviewing = review !== null

  return (
    <div className="camera">
      {/* Always mounted so Retake returns to a live preview instantly (no restart). */}
      <video ref={videoRef} className="camera__video" autoPlay muted playsInline />

      {/* The captured photo, layered over the still-running preview. */}
      {review && <img src={review.url} className="camera__review" alt="Снимок" />}

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

      {/* Controls — shutter while streaming; Retake while reviewing.
          Cancel lives in the top bar. Hidden during starting/denied/error so the
          status overlay is unobstructed. (Saving arrives in ticket 02.) */}
      {(reviewing || status === 'streaming') && (
        <div className="camera__controls">
          {reviewing ? (
            <Button size="md" variant="filled" onClick={() => setReview(null)}>
              Переснять
            </Button>
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
