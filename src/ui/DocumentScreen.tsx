import { Box, Button, Image, Loader, LoadingOverlay, Stack, Text } from '@mantine/core'
import { useEffect, useRef, useState } from 'react'
import { CornerEditorView, type CornerEditorHandle } from '../corner-editor/CornerEditorView'
import { useImageSize } from '../corner-editor/useImageSize'
import { opfsStorage } from '../storage/opfs-storage'
import {
  removeDocument,
  replacePageEnhanced,
  replacePageFlat,
  replacePageQuad,
  setPageEnhanced,
  setPageFlat,
  updatePageQuad,
} from '../storage/useDocuments'
import type { Bytes, Document } from '../types'
import { cvClient } from '../worker/cv-client'
import { ScreenShell } from './ScreenShell'

interface DocumentScreenProps {
  docId: string
  onBack: () => void
}

export function DocumentScreen({ docId, onBack }: DocumentScreenProps) {
  const [doc, setDoc] = useState<Document | undefined>(undefined)
  const [sourceUrl, setSourceUrl] = useState<string | undefined>(undefined)
  const [flatUrl, setFlatUrl] = useState<string | undefined>(undefined)
  const [enhancedUrl, setEnhancedUrl] = useState<string | undefined>(undefined)
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
  // The flat path currently materialised as `flatUrl`, so the sync effect only
  // re-reads when the persisted flat actually changes.
  const loadedFlatFileRef = useRef<string | undefined>(undefined)
  // The enhanced path currently materialised as `enhancedUrl` (same idea).
  const loadedEnhancedFileRef = useRef<string | undefined>(undefined)

  const firstPage = doc?.pages[0]
  const flatFile = firstPage?.flat?.file
  const enhancedFile = firstPage?.enhanced?.file
  const imageSize = useImageSize(sourceUrl)

  // Load the Document and its source photo (keep the bytes for the warp).
  useEffect(() => {
    let url: string | undefined
    let cancelled = false
    opfsStorage.getDocument(docId).then(async (d) => {
      if (cancelled || !d) return
      setDoc(d)
      const first = d.pages[0]
      if (!first) return
      const blob = await opfsStorage.getPageImage(first.file)
      if (cancelled || !blob) return
      sourceBytesRef.current = new Uint8Array(await blob.arrayBuffer())
      url = URL.createObjectURL(blob)
      setSourceUrl(url)
    })
    return () => {
      cancelled = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [docId])

  // Keep the displayed flat image in sync with the persisted flat on the Page.
  useEffect(() => {
    if (loadedFlatFileRef.current === flatFile) return
    loadedFlatFileRef.current = flatFile
    if (!flatFile) {
      setFlatUrl(undefined)
      return
    }
    let cancelled = false
    opfsStorage.getPageImage(flatFile).then((blob) => {
      if (cancelled || !blob) return
      setFlatUrl(URL.createObjectURL(blob))
    })
    return () => {
      cancelled = true
    }
  }, [flatFile])

  // Revoke the flat object URL when it changes or on unmount.
  useEffect(() => {
    if (!flatUrl) return
    return () => URL.revokeObjectURL(flatUrl)
  }, [flatUrl])

  // Keep the displayed enhanced image in sync with the persisted enhanced result.
  useEffect(() => {
    if (loadedEnhancedFileRef.current === enhancedFile) return
    loadedEnhancedFileRef.current = enhancedFile
    if (!enhancedFile) {
      setEnhancedUrl(undefined)
      return
    }
    let cancelled = false
    opfsStorage.getPageImage(enhancedFile).then((blob) => {
      if (cancelled || !blob) return
      setEnhancedUrl(URL.createObjectURL(blob))
    })
    return () => {
      cancelled = true
    }
  }, [enhancedFile])

  // Revoke the enhanced object URL when it changes or on unmount.
  useEffect(() => {
    if (!enhancedUrl) return
    return () => URL.revokeObjectURL(enhancedUrl)
  }, [enhancedUrl])

  // A flat signature of the inputs that should (re)trigger a warp: the page,
  // its current flat path, the boundary Quad, the loaded source, and the retry
  // counter. Excludes `warping`/`warpError` so toggling them can't loop.
  const quadSig = firstPage ? firstPage.quad.map((p) => `${p.x},${p.y}`).join(';') : ''

  // Flatten the page in the worker when there's no flat yet (or the boundary
  // changed and the stale flat was dropped). Runs off the main thread so the UI
  // stays responsive; a brief processing state covers the wait.
  useEffect(() => {
    if (!doc || !firstPage || !sourceUrl) return
    if (firstPage.flat) return
    if (warpInFlightRef.current) return
    let cancelled = false
    warpInFlightRef.current = true
    setWarping(true)
    setWarpError(undefined)
    const bytes = sourceBytesRef.current
    const pageId = firstPage.id
    const quad = firstPage.quad
    void (async () => {
      try {
        if (!bytes) throw new Error('source photo not loaded')
        const result = await cvClient.warp(bytes, quad)
        if (cancelled) return
        if (!result.ok) {
          setWarpError(result.error || 'Не удалось выровнять страницу')
          return
        }
        const flat = await setPageFlat(doc.id, pageId, result.bytes, result.width, result.height)
        if (cancelled) return
        setDoc((cur) => (cur ? replacePageFlat(cur, pageId, flat) : cur))
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
  }, [doc?.id, firstPage?.id, flatFile, sourceUrl, warpVersion, quadSig])

  // Enhance the page in the worker once a flat exists but no enhanced result
  // does (first view, or after a corner edit / mode change invalidated it).
  // Re-runs off the flat, so it only fires after the warp has settled; a brief
  // processing state covers the wait and the flat stays visible underneath.
  useEffect(() => {
    if (!doc || !firstPage || !firstPage.flat) return
    if (firstPage.enhanced) return
    if (enhanceInFlightRef.current) return
    let cancelled = false
    enhanceInFlightRef.current = true
    setEnhancing(true)
    setEnhanceError(undefined)
    const docId = doc.id
    const pageId = firstPage.id
    const mode = firstPage.enhanceMode
    const flatPath = firstPage.flat.file
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
        if (cancelled) return
        setDoc((cur) => (cur ? replacePageEnhanced(cur, pageId, enhanced) : cur))
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
  }, [doc?.id, firstPage?.id, flatFile, enhancedFile, firstPage?.enhanceMode, enhanceVersion])

  async function handleSaveQuad(): Promise<void> {
    const page = firstPage
    const quad = editorRef.current?.getQuad()
    if (!doc || !page || !quad) return
    setSavingQuad(true)
    try {
      await updatePageQuad(doc.id, page.id, quad)
      // Mirror the persisted Quad locally — replacePageQuad also drops the now-
      // stale flat, so the effect above re-warps with the corrected corners.
      setDoc((d) => (d ? replacePageQuad(d, page.id, quad) : d))
      setEditing(false)
    } finally {
      setSavingQuad(false)
    }
  }

  // Full-screen boundary editor overlay. Shown only once the source photo and
  // its dimensions are loaded. Disabled while a warp runs so the boundary can't
  // change under an in-flight flatten.
  if (editing && doc && firstPage && sourceUrl && imageSize) {
    return (
      <div className="boundary-editor">
        <CornerEditorView
          className="boundary-editor__svg"
          image={imageSize}
          src={sourceUrl}
          initialQuad={firstPage.quad}
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
    <ScreenShell
      title={doc?.title ?? 'Документ'}
      action={
        <Button variant="subtle" size="sm" onClick={onBack}>
          Назад
        </Button>
      }
    >
      <Stack gap="md" align="stretch">
        {enhancedUrl ? (
          <Image src={enhancedUrl} alt={doc?.title} radius="md" bg="white" />
        ) : flatUrl ? (
          <>
            <Box pos="relative">
              <Image src={flatUrl} alt={doc?.title} radius="md" bg="white" />
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
        <Text size="sm" c="dimmed" ta="center">
          {doc ? `${doc.pages.length} стр.` : 'загрузка…'}
        </Text>
        <Button
          variant="light"
          disabled={!doc || !sourceUrl || !imageSize || warping || enhancing}
          onClick={() => setEditing(true)}
        >
          Изменить границы
        </Button>
        <Button
          color="red"
          variant="light"
          disabled={!doc}
          onClick={async () => {
            await removeDocument(docId)
            onBack()
          }}
        >
          Удалить
        </Button>
        <Text size="xs" c="dimmed" ta="center">
          Экспорт в PDF — этап M7.
        </Text>
      </Stack>
    </ScreenShell>
  )
}
