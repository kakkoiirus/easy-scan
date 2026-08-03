import { Button, Image, Stack, Text } from '@mantine/core'
import { useEffect, useRef, useState } from 'react'
import { CornerEditorView, type CornerEditorHandle } from '../corner-editor/CornerEditorView'
import { useImageSize } from '../corner-editor/useImageSize'
import { opfsStorage } from '../storage/opfs-storage'
import { removeDocument, replacePageQuad, updatePageQuad } from '../storage/useDocuments'
import type { Document } from '../types'
import { ScreenShell } from './ScreenShell'

interface DocumentScreenProps {
  docId: string
  onBack: () => void
}

export function DocumentScreen({ docId, onBack }: DocumentScreenProps) {
  const [doc, setDoc] = useState<Document | undefined>(undefined)
  const [sourceUrl, setSourceUrl] = useState<string | undefined>(undefined)
  const [editing, setEditing] = useState(false)
  const [savingQuad, setSavingQuad] = useState(false)
  const editorRef = useRef<CornerEditorHandle>(null)

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
      url = URL.createObjectURL(blob)
      setSourceUrl(url)
    })
    return () => {
      cancelled = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [docId])

  // Natural pixel dimensions of the source photo — needed to size the editor's
  // coordinate space. Reads oriented dims so they match the stored Quad.
  const imageSize = useImageSize(sourceUrl)
  const firstPage = doc?.pages[0]

  async function handleSaveQuad(): Promise<void> {
    const page = firstPage
    const quad = editorRef.current?.getQuad()
    if (!doc || !page || !quad) return
    setSavingQuad(true)
    try {
      await updatePageQuad(doc.id, page.id, quad)
      // Mirror the persisted Quad into local state so re-opening the editor
      // (or re-flattening later) sees the corrected Quad, not the stale one.
      setDoc((d) => (d ? replacePageQuad(d, page.id, quad) : d))
      setEditing(false) // adjusted Quad persisted; close the editor
    } finally {
      setSavingQuad(false)
    }
  }

  // Full-screen boundary editor overlay. Shown only once the source photo and
  // its dimensions are loaded.
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
        {sourceUrl ? (
          <Image src={sourceUrl} alt={doc?.title} radius="md" bg="white" />
        ) : (
          <Text size="sm" c="dimmed" ta="center">
            нет превью
          </Text>
        )}
        <Text size="sm" c="dimmed" ta="center">
          {doc ? `${doc.pages.length} стр.` : 'загрузка…'}
        </Text>
        <Button
          variant="light"
          disabled={!doc || !sourceUrl || !imageSize}
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
