import { Button, Image, Stack, Text } from '@mantine/core'
import { useEffect, useState } from 'react'
import { opfsStorage } from '../storage/opfs-storage'
import { removeDocument } from '../storage/useDocuments'
import type { Document } from '../types'
import { ScreenShell } from './ScreenShell'

interface DocumentScreenProps {
  docId: string
  onBack: () => void
}

export function DocumentScreen({ docId, onBack }: DocumentScreenProps) {
  const [doc, setDoc] = useState<Document | undefined>(undefined)
  const [thumbUrl, setThumbUrl] = useState<string | undefined>(undefined)

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
      setThumbUrl(url)
    })
    return () => {
      cancelled = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [docId])

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
        {thumbUrl ? (
          <Image src={thumbUrl} alt={doc?.title} radius="md" bg="white" />
        ) : (
          <Text size="sm" c="dimmed" ta="center">
            нет превью
          </Text>
        )}
        <Text size="sm" c="dimmed" ta="center">
          {doc ? `${doc.pages.length} стр.` : 'загрузка…'}
        </Text>
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
