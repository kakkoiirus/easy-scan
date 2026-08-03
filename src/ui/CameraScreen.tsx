import { Badge, Button, Group, Loader, Stack, Text } from '@mantine/core'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import { cameraController, type CapturedFrame } from '../camera/camera-controller'
import { CornerEditorView, type CornerEditorHandle } from '../corner-editor/CornerEditorView'
import { fullFrameQuad } from '../corner-editor/geometry'
import { appendPage, createDocument, removeDocument } from '../storage/useDocuments'
import { cvClient } from '../worker/cv-client'
import type { Quad } from '../types'

interface CameraScreenProps {
  onBack: () => void
}

/** A captured frame, its object URL, and its detected boundary.
 *  `quad` is null only while detection is running; it becomes the detected Quad
 *  or the full-frame fallback once detection settles. */
interface Review {
  readonly url: string
  readonly frame: CapturedFrame
  readonly quad: Quad | null
  readonly detecting: boolean
}

/** A page stashed in an in-memory capture session. The source bytes are held in
 *  memory (no object URL — persistence consumes the bytes directly); nothing is
 *  written to storage until "Готово". Cancel/back discards the whole batch. */
interface SessionPage {
  readonly frame: CapturedFrame
  readonly quad: Quad
}

export function CameraScreen({ onBack }: CameraScreenProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const editorRef = useRef<CornerEditorHandle>(null)
  const status = useSyncExternalStore(
    cameraController.subscribe,
    cameraController.getStatus,
    cameraController.getStatus,
  )
  const [review, setReview] = useState<Review | null>(null)
  const [session, setSession] = useState<readonly SessionPage[]>([])
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
      // Detect the boundary in the worker. On error or no-match, fall back to a
      // full-frame Quad so the user can still drag the corners on by hand.
      const size = { width: frame.width, height: frame.height }
      let quad: Quad
      try {
        const result = await cvClient.detect(frame.bytes)
        quad = result.ok ? result.quad : fullFrameQuad(size)
      } catch {
        quad = fullFrameQuad(size)
      }
      setReview((r) => (r && r.url === url ? { ...r, quad, detecting: false } : r))
    } catch {
      // Capture failed (e.g. stream ended) — stay in the live preview.
    } finally {
      setCapturing(false)
    }
  }

  /** The live (possibly hand-adjusted) Quad for the page under review, falling
   *  back to the detected Quad, then the full-frame placeholder. The buttons that
   *  use it are disabled while detection is still running, so by the time this is
   *  read the boundary has settled. */
  function reviewQuad(): Quad {
    if (!review) throw new Error('no page under review')
    const size = { width: review.frame.width, height: review.frame.height }
    return editorRef.current?.getQuad() ?? review.quad ?? fullFrameQuad(size)
  }

  /** Snapshot the page under review into a stashed session page: its source bytes
   *  (held in memory) and the finalized boundary. Centralizes the review→session
   *  transform used by both "Добавить страницу" and "Готово". */
  function reviewToSessionPage(): SessionPage {
    if (!review) throw new Error('no page under review')
    return { frame: review.frame, quad: reviewQuad() }
  }

  /** Stash the page under review and return to the live preview for the next
   *  shot. The camera stays mounted (no restart); cancelling later keeps the
   *  earlier stashed pages. */
  function handleAddPage(): void {
    if (!review) return
    setSession((s) => [...s, reviewToSessionPage()])
    setReview(null)
  }

  /** Persist the whole batch as one Document: createDocument once, then
   *  appendPage per captured page (the in-progress review is finalized in too, so
   *  finishing from review saves it along with the rest). Nothing was written
   *  before this; on success we leave the screen (unmount stops the camera). */
  async function handleDone(): Promise<void> {
    const reviewed = review ? [reviewToSessionPage()] : []
    const pages = [...session, ...reviewed]
    if (pages.length === 0) return
    setSaving(true)
    let docId: string | null = null
    try {
      docId = await createDocument(`Документ · ${new Date().toLocaleTimeString()}`)
      for (const page of pages) await appendPage(docId, page.frame, page.quad)
      onBack()
    } catch {
      // Persist failed mid-batch — remove the partial Document (and the JPEGs
      // already written) so a retry starts clean: the library never holds a
      // half-saved batch, and retrying can't produce a duplicate. The in-memory
      // session is untouched, so the user can retry or cancel.
      if (docId) await removeDocument(docId).catch(() => {})
      setSaving(false)
    }
  }

  const reviewing = review !== null
  const detecting = review?.detecting ?? false
  const finishLabel = session.length > 0 ? 'Готово' : 'Сохранить'
  const inSession = session.length > 0

  return (
    <div className="camera">
      {/* Always mounted so Retake returns to a live preview instantly (no restart). */}
      <video ref={videoRef} className="camera__video" autoPlay muted playsInline />

      {review && (
        // One SVG whose viewBox is the image's pixels: photo + quad share the same
        // user space, so the overlay aligns with no measuring. The photo shows
        // while detection runs (initialQuad null); corners become draggable
        // once the boundary is known.
        <CornerEditorView
          className="camera__review"
          image={{ width: review.frame.width, height: review.frame.height }}
          src={review.url}
          initialQuad={review.quad}
          ref={editorRef}
        />
      )}

      {detecting && (
        <div className="camera__detecting">
          <Loader size="sm" />
          <Text size="xs">Определение границ…</Text>
        </div>
      )}

      {/* Captured-pages counter — shown mid-session, in preview and review alike. */}
      {inSession && (
        <div className="camera__counter">
          <Badge variant="filled" color="dark" size="lg">
            Стр.: {session.length}
          </Badge>
        </div>
      )}

      <div className="camera__topbar">
        <Button variant="light" size="xs" color="gray" onClick={onBack}>
          {reviewing || inSession ? 'Отмена' : 'Назад'}
        </Button>
        {/* In the live preview, a stashed batch can be finished without another
            shot — "Готово" sits top-right. (While reviewing, finishing is the
            primary bottom button instead.) */}
        {!reviewing && inSession && (
          <Button variant="light" size="xs" loading={saving} onClick={handleDone}>
            Готово
          </Button>
        )}
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

      {/* Controls — shutter while streaming; Add/Done/Retake while reviewing. */}
      {(reviewing || status === 'streaming') && (
        <div className="camera__controls">
          {reviewing ? (
            <Stack align="center" gap="xs">
              <Button size="md" loading={saving} disabled={detecting} onClick={handleDone}>
                {finishLabel}
              </Button>
              <Button
                variant="light"
                size="xs"
                disabled={saving || detecting}
                onClick={handleAddPage}
              >
                Добавить страницу
              </Button>
              <Group gap="xs">
                <Button
                  variant="subtle"
                  color="gray"
                  size="xs"
                  disabled={saving || detecting}
                  onClick={() => editorRef.current?.reset()}
                >
                  Сбросить
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
              </Group>
            </Stack>
          ) : (
            <button
              type="button"
              className="camera__shutter"
              aria-label="Сделать снимок"
              disabled={capturing || saving}
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
