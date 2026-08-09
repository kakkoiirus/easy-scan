import { Button, Group, Stack, Text } from '@mantine/core'
import { useCallback, useEffect, useState } from 'react'
import { exportDocument } from '../export/export-document'
import { opfsStorage } from '../storage/opfs-storage'
import {
  movePage,
  movePageInDocument,
  removeDocument,
  removePage,
} from '../storage/useDocuments'
import type { Document } from '../types'
import { PagePane } from './PagePane'
import { PageStrip } from './PageStrip'
import { ScreenShell } from './ScreenShell'

interface DocumentScreenProps {
  docId: string
  onBack: () => void
  /** Open the camera in add-page mode, bound to this Document. */
  onAddPage: () => void
}

/** PDF-export UI state — idle, preparing the pages + PDF, or a surfaced error. */
type ExportState =
  | { readonly status: 'idle' }
  | { readonly status: 'exporting' }
  | { readonly status: 'error'; readonly message: string }

export function DocumentScreen({ docId, onBack, onAddPage }: DocumentScreenProps) {
  const [doc, setDoc] = useState<Document | undefined>(undefined)
  // The page the user is viewing/editing. Undefined until they pick one, in
  // which case the first page is shown — so opening a Document selects page 1.
  const [selectedPageId, setSelectedPageId] = useState<string | undefined>(undefined)
  // PDF export: a discriminated union so idle / preparing / error can't combine
  // into an impossible state. Mirrors the `ExportOutcome` shape export returns.
  const [exportState, setExportState] = useState<ExportState>({ status: 'idle' })

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

  // Index of the shown page in document order — drives the move-up/down enables.
  const selectedPageIndex = doc?.pages.findIndex((p) => p.id === selectedPage?.id) ?? -1

  /** Remove a single Page. Its source/flat/enhanced files are reclaimed; if it
   *  was the last Page the whole Document is deleted and we return to the
   *  library (no empty Documents). The selection falls back to the page now
   *  sitting at the deleted slot — the next one, or the previous if it was last
   *  — so the view never lands on a blank/broken state. Persisted first; the
   *  local state only updates on success, so a failed remove leaves the UI
   *  matching storage. */
  async function handleDeletePage(pageId: string): Promise<void> {
    const current = doc
    if (!current) return
    const deletedIndex = current.pages.findIndex((p) => p.id === pageId)
    if (deletedIndex === -1) return
    try {
      await removePage(docId, pageId)
    } catch {
      return
    }
    const remaining = current.pages.filter((p) => p.id !== pageId)
    if (remaining.length === 0) {
      onBack()
      return
    }
    setDoc({ ...current, pages: remaining })
    setSelectedPageId(remaining[Math.min(deletedIndex, remaining.length - 1)].id)
  }

  /** Move the selected Page one slot earlier (`dir = -1`) or later (`dir = 1`).
   *  Persisted first; on success the local order updates. The selection stays on
   *  the moved Page (its id is unchanged), so the view follows it to its new
   *  position and the strip re-renders in the new order. No-op at the ends. */
  async function handleMovePage(pageId: string, dir: -1 | 1): Promise<void> {
    const current = doc
    if (!current) return
    const from = current.pages.findIndex((p) => p.id === pageId)
    if (from === -1) return
    const to = from + dir
    if (to < 0 || to >= current.pages.length) return
    try {
      await movePage(docId, from, to)
    } catch {
      return
    }
    setDoc(movePageInDocument(current, from, to))
  }

  /** Export the Document to a multi-page PDF. Any page not yet materialised is
   *  prepared first (the worker runs its flatten/enhance), so the PDF always
   *  reflects the chosen look; the file is then shared on mobile or downloaded.
   *  The Document is re-read afterwards so freshly-materialised pages show. */
  async function handleExport(): Promise<void> {
    if (!doc || exportState.status === 'exporting') return
    setExportState({ status: 'exporting' })
    try {
      const outcome = await exportDocument(docId)
      setExportState(outcome.ok ? { status: 'idle' } : { status: 'error', message: outcome.error })
    } finally {
      // Reflect any pages materialised during export (flat/enhanced now on disk).
      opfsStorage.getDocument(docId).then((fresh) => {
        if (fresh) setDoc(fresh)
      })
    }
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
        {doc && doc.pages.length > 1 && (
          <PageStrip
            pages={doc.pages}
            selectedPageId={selectedPage?.id}
            onSelect={setSelectedPageId}
          />
        )}
        {/* Per-page actions sit with the strip and act on the selected page.
            Reorder is only meaningful with more than one page; the ends disable
            move-up / move-down. Deleting the selected page falls back to a
            sibling (handled in `handleDeletePage`). */}
        {doc && selectedPage && (
          <>
            {doc.pages.length > 1 && (
              <Group gap="xs" grow>
                <Button
                  variant="light"
                  size="xs"
                  disabled={selectedPageIndex <= 0}
                  onClick={() => void handleMovePage(selectedPage.id, -1)}
                >
                  Вверх
                </Button>
                <Button
                  variant="light"
                  size="xs"
                  disabled={selectedPageIndex >= doc.pages.length - 1}
                  onClick={() => void handleMovePage(selectedPage.id, 1)}
                >
                  Вниз
                </Button>
              </Group>
            )}
            <Button
              variant="light"
              color="red"
              onClick={() => void handleDeletePage(selectedPage.id)}
            >
              Удалить страницу
            </Button>
          </>
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
          color="blue"
          loading={exportState.status === 'exporting'}
          disabled={!doc || exportState.status === 'exporting'}
          onClick={() => void handleExport()}
        >
          {exportState.status === 'exporting' ? 'готовим страницы…' : 'Экспорт PDF'}
        </Button>
        {exportState.status === 'error' && (
          <Text size="xs" c="red" ta="center">
            {exportState.message}
          </Text>
        )}
        <Button variant="light" disabled={!doc} onClick={onAddPage}>
          Добавить страницу
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
          Удалить документ
        </Button>
      </Stack>
    </ScreenShell>
  )
}
