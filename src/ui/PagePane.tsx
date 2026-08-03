import { Box, Button, Image, Loader, LoadingOverlay, SegmentedControl, Stack, Text } from '@mantine/core'
import { useEffect, useRef, useState } from 'react'
import { CornerEditorView, type CornerEditorHandle } from '../corner-editor/CornerEditorView'
import { useImageSize } from '../corner-editor/useImageSize'
import { opfsStorage } from '../storage/opfs-storage'
import {
  replacePageEnhanceMode,
  replacePageEnhanced,
  replacePageFlat,
  replacePageQuad,
  setPageEnhanced,
  setPageFlat,
  updatePageEnhanceMode,
  updatePageQuad,
} from '../storage/useDocuments'
import type { Bytes, Document, EnhanceMode, Page } from '../types'
import { cvClient } from '../worker/cv-client'
import { useObjectUrl } from './useObjectUrl'

/**
 * The view + edit surface for ONE selected Page of a Document: its enhanced/flat
 * image, the lazy warp + enhance that produce it, the boundary editor, and the
 * enhance-mode switch.
 *
 * The parent mounts this with `key={page.id}`, so every piece of per-page state
 * (object URLs, in-flight guards, edit flags) is freshly initialised for the
 * selected page and torn down — object URLs revoked — when the selection moves.
 * All mutations flow up through `onDocChange`, which updates the single shared
 * Document so edits to one page survive switching to another.
 */
interface PagePaneProps {
  readonly docId: string
  readonly page: Page
  readonly onDocChange: (updater: (doc: Document) => Document) => void
}

export function PagePane({ docId, page, onDocChange }: PagePaneProps) {
  const [sourceUrl, setSourceUrl] = useState<string | undefined>(undefined)
  const [editing, setEditing] = useState(false)
  const [savingQuad, setSavingQuad] = useState(false)
  const [warping, setWarping] = useState(false)
  const [warpError, setWarpError] = useState<string | undefined>(undefined)
  // Bumped by the Retry button to re-trigger a failed warp (the warp-key below
  // would otherwise be unchanged after an error, so the effect wouldn't re-run).
  const [warpVersion, setWarpVersion] = useState(0)
  const [enhancing, setEnhancing] = useState(false)
  const [enhanceError, setEnhanceError] = useState<string | undefined>(undefined)
  // Bumped by the Retry button to re-trigger a failed enhance (same reason as warpVersion).
  const [enhanceVersion, setEnhanceVersion] = useState(0)

  const editorRef = useRef<CornerEditorHandle>(null)
  // Source JPEG bytes kept in a ref so the warp can run without re-fetching.
  const sourceBytesRef = useRef<Bytes | null>(null)
  // Guards against overlapping warps (e.g. React StrictMode double-invoke in dev).
  const warpInFlightRef = useRef(false)
  // Guards against overlapping enhances.
  const enhanceInFlightRef = useRef(false)

  const flatFile = page.flat?.file
  const enhancedFile = page.enhanced?.file
  // The displayed flat/enhanced images follow their persisted files: the hook
  // loads each on demand and revokes it on change/unmount, so a page switch
  // never leaks the previous page's object URLs.
  const flatUrl = useObjectUrl(flatFile)
  const enhancedUrl = useObjectUrl(enhancedFile)
  const imageSize = useImageSize(sourceUrl)

  // Load the selected page's source photo (keep the bytes for the warp). Re-runs
  // per mount (the parent keys this component by page id), so switching pages
  // re-loads and revokes the previous page's source URL in the cleanup below.
  useEffect(() => {
    let url: string | undefined
    let cancelled = false
    opfsStorage.getPageImage(page.file).then(async (blob) => {
      if (cancelled || !blob) return
      sourceBytesRef.current = new Uint8Array(await blob.arrayBuffer())
      // Re-check after the await: if the page switched while reading the bytes,
      // bail before creating a URL the cleanup (already run) can't revoke.
      if (cancelled) return
      url = URL.createObjectURL(blob)
      setSourceUrl(url)
    })
    return () => {
      cancelled = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [page.file])

  // A flat signature of the inputs that should (re)trigger a warp: the page,
  // its current flat path, the boundary Quad, the loaded source, and the retry
  // counter. Excludes `warping`/`warpError` so toggling them can't loop.
  const quadSig = page.quad.map((p) => `${p.x},${p.y}`).join(';')

  // Flatten the page in the worker when there's no flat yet (or the boundary
  // changed and the stale flat was dropped). Runs off the main thread so the UI
  // stays responsive; a brief processing state covers the wait.
  useEffect(() => {
    if (!sourceUrl) return
    if (page.flat) return
    if (warpInFlightRef.current) return
    let cancelled = false
    warpInFlightRef.current = true
    setWarping(true)
    setWarpError(undefined)
    const bytes = sourceBytesRef.current
    const pageId = page.id
    const quad = page.quad
    void (async () => {
      try {
        if (!bytes) throw new Error('source photo not loaded')
        const result = await cvClient.warp(bytes, quad)
        if (cancelled) return
        if (!result.ok) {
          setWarpError(result.error || 'Не удалось выровнять страницу')
          return
        }
        const flat = await setPageFlat(docId, pageId, result.bytes, result.width, result.height)
        // Reflect the persisted flat in the shared doc BEFORE bailing on cancel:
        // the flat is already written, so updating here stops a later re-select
        // of this page from re-warping (and overwriting) the same flat.
        onDocChange((d) => replacePageFlat(d, pageId, flat))
        if (cancelled) return
      } catch (err) {
        if (cancelled) return
        setWarpError(err instanceof Error ? err.message : 'Не удалось выровнять страницу')
      } finally {
        if (cancelled) return // cleanup owns the reset on cancel
        setWarping(false)
        warpInFlightRef.current = false
      }
    })()
    return () => {
      cancelled = true
      warpInFlightRef.current = false
    }
  }, [docId, page.id, page.flat, flatFile, sourceUrl, warpVersion, quadSig, onDocChange])

  // Enhance the page in the worker once a flat exists but no enhanced result
  // does (first view, or after a corner edit / mode change invalidated it).
  // Re-runs off the flat, so it only fires after the warp has settled; a brief
  // processing state covers the wait and the flat stays visible underneath.
  useEffect(() => {
    if (!page.flat) return
    if (page.enhanced) return
    if (enhanceInFlightRef.current) return
    let cancelled = false
    enhanceInFlightRef.current = true
    setEnhancing(true)
    setEnhanceError(undefined)
    const pageId = page.id
    const mode = page.enhanceMode
    const flatPath = page.flat.file
    void (async () => {
      try {
        const blob = await opfsStorage.getPageImage(flatPath)
        if (cancelled || !blob) throw new Error('flat image not found')
        const bytes = new Uint8Array(await blob.arrayBuffer())
        if (cancelled) return
        const result = await cvClient.enhance(bytes, mode)
        if (cancelled) return
        if (!result.ok) {
          setEnhanceError(result.error || 'Не удалось улучшить страницу')
          return
        }
        const enhanced = await setPageEnhanced(docId, pageId, result.bytes, result.width, result.height)
        // See the warp effect: persist already landed, so mirror it into the doc
        // even on a mid-enhance unmount to avoid a redundant re-enhance.
        onDocChange((d) => replacePageEnhanced(d, pageId, enhanced))
        if (cancelled) return
      } catch (err) {
        if (cancelled) return
        setEnhanceError(err instanceof Error ? err.message : 'Не удалось улучшить страницу')
      } finally {
        if (cancelled) return // cleanup owns the reset on cancel
        setEnhancing(false)
        enhanceInFlightRef.current = false
      }
    })()
    return () => {
      cancelled = true
      enhanceInFlightRef.current = false
    }
  }, [docId, page.id, page.flat, flatFile, enhancedFile, page.enhanceMode, enhanceVersion, onDocChange])

  async function handleSaveQuad(): Promise<void> {
    const quad = editorRef.current?.getQuad()
    if (!quad) return
    setSavingQuad(true)
    try {
      await updatePageQuad(docId, page.id, quad)
      // Mirror the persisted Quad locally — replacePageQuad also drops the now-
      // stale flat, so the effect above re-warps with the corrected corners.
      onDocChange((d) => replacePageQuad(d, page.id, quad))
      setEditing(false)
    } finally {
      setSavingQuad(false)
    }
  }

  /**
   * Switch the page's enhance mode. Optimistic: the control snaps to the new
   * mode and clears the cached enhanced image so the enhance effect re-runs off
   * the flat with the new look; the persist follows, and rolls back on failure
   * so the control never shows a mode that isn't actually stored.
   */
  async function handleChangeEnhanceMode(mode: EnhanceMode): Promise<void> {
    if (page.enhanceMode === mode) return
    const prev = page.enhanceMode
    onDocChange((d) => replacePageEnhanceMode(d, page.id, mode))
    try {
      await updatePageEnhanceMode(docId, page.id, mode)
    } catch {
      onDocChange((d) => replacePageEnhanceMode(d, page.id, prev))
    }
  }

  // Full-screen boundary editor overlay. Shown only once the source photo and
  // its dimensions are loaded. Disabled while a warp runs so the boundary can't
  // change under an in-flight flatten.
  if (editing && sourceUrl && imageSize) {
    return (
      <div className="boundary-editor">
        <CornerEditorView
          className="boundary-editor__svg"
          image={imageSize}
          src={sourceUrl}
          initialQuad={page.quad}
          ref={editorRef}
        />
        <div className="boundary-editor__controls">
          <Button variant="subtle" color="gray" disabled={savingQuad} onClick={() => setEditing(false)}>
            Отмена
          </Button>
          <Button variant="light" disabled={savingQuad} onClick={() => editorRef.current?.reset()}>
            Сбросить
          </Button>
          <Button loading={savingQuad} onClick={handleSaveQuad}>
            Сохранить
          </Button>
        </div>
      </div>
    )
  }

  return (
    <Stack gap="md" align="stretch">
      <Stack gap="xs">
        <Text size="sm" fw={500}>
          Вид
        </Text>
        <SegmentedControl
          value={page.enhanceMode}
          onChange={(value) => void handleChangeEnhanceMode(value as EnhanceMode)}
          data={[
            { value: 'color', label: 'Цвет' },
            { value: 'grayscale', label: 'Серый' },
            { value: 'bw', label: 'Ч/Б' },
          ]}
          disabled={!page.flat || warping}
          fullWidth
        />
      </Stack>
      {enhancedUrl ? (
        <Image src={enhancedUrl} alt="" radius="md" bg="white" />
      ) : flatUrl ? (
        <>
          <Box pos="relative">
            <Image src={flatUrl} alt="" radius="md" bg="white" />
            <LoadingOverlay visible={enhancing} loaderProps={{ size: 'sm' }} />
          </Box>
          {enhanceError && (
            <Stack align="center" gap="xs">
              <Text size="sm" c="red" ta="center">
                Не удалось улучшить страницу.
              </Text>
              <Text size="xs" c="dimmed" ta="center">
                {enhanceError}
              </Text>
              <Button
                variant="light"
                size="xs"
                onClick={() => {
                  setEnhanceError(undefined)
                  setEnhanceVersion((v) => v + 1)
                }}
              >
                Повторить
              </Button>
            </Stack>
          )}
        </>
      ) : warping ? (
        <Stack align="center" justify="center" gap="xs" mih="40vh">
          <Loader size="sm" />
          <Text size="sm" c="dimmed">
            Выравнивание страницы…
          </Text>
        </Stack>
      ) : warpError ? (
        <Stack align="center" justify="center" gap="xs" mih="40vh">
          <Text size="sm" c="red" ta="center">
            Не удалось выровнять страницу.
          </Text>
          <Text size="xs" c="dimmed" ta="center">
            {warpError}
          </Text>
          <Button
            variant="light"
            size="xs"
            mt="xs"
            onClick={() => {
              setWarpError(undefined)
              setWarpVersion((v) => v + 1)
            }}
          >
            Повторить
          </Button>
        </Stack>
      ) : (
        <Text size="sm" c="dimmed" ta="center">
          подготовка…
        </Text>
      )}
      <Button
        variant="light"
        disabled={!sourceUrl || !imageSize || warping || enhancing}
        onClick={() => setEditing(true)}
      >
        Изменить границы
      </Button>
    </Stack>
  )
}
