import { Button, Stack, Text } from '@mantine/core'
import { useCallback, useEffect, useState } from 'react'
import { opfsStorage } from '../storage/opfs-storage'
import { removeDocument } from '../storage/useDocuments'
import type { Document } from '../types'
import { PagePane } from './PagePane'
import { PageStrip } from './PageStrip'
import { ScreenShell } from './ScreenShell'

interface DocumentScreenProps {
  docId: string
  onBack: () => void
}

export function DocumentScreen({ docId, onBack }: DocumentScreenProps) {
  const [doc, setDoc] = useState<Document | undefined>(undefined)
  // The page the user is viewing/editing. Undefined until they pick one, in
  // which case the first page is shown — so opening a Document selects page 1.
  const [selectedPageId, setSelectedPageId] = useState<string | undefined>(undefined)

  // Load the Document. Only the doc lives here; each Page's source/flat/enhanced
  // bytes are owned by the keyed `PagePane` below, so switching pages re-loads
  // just that page and revokes the previous one's object URLs.
  useEffect(() => {
    let cancelled = false
    opfsStorage.getDocument(docId).then((d) => {
      if (cancelled) return
      setDoc(d)
    })
    return () => {
      cancelled = true
    }
  }, [docId])

  // The explicitly selected page, else the first page. The single source of
  // truth is `doc`; edits from the pane flow back through `updateDoc` so every
  // page's state (flat/enhanced/quad/mode) survives switching to another.
  const selectedPage = doc?.pages.find((p) => p.id === selectedPageId) ?? doc?.pages[0]

  const updateDoc = useCallback(
    (updater: (d: Document) => Document): void => {
      setDoc((cur) => (cur ? updater(cur) : cur))
    },
    [],
  )

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
        {doc && doc.pages.length > 1 && (
          <PageStrip
            pages={doc.pages}
            selectedPageId={selectedPage?.id}
            onSelect={setSelectedPageId}
          />
        )}
        {doc && selectedPage && (
          <PagePane
            key={selectedPage.id}
            docId={doc.id}
            page={selectedPage}
            onDocChange={updateDoc}
          />
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
