import { Button, Group, Stack, Text } from '@mantine/core'
import { useState } from 'react'
import { exportDocument } from '../export/export-document'
import { documentStore, useDocument } from '../storage/document-store'
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
  // The open Document is reactive state owned by the store (sole writer); this
  // component holds NO copy of it. It loads on first bind and stays in sync as
  // mutations — from here, from PagePane, even from export's materialise — flow
  // through the store. So there is nothing to mirror or re-read after an edit.
  const doc = useDocument(docId)
  // The page the user is viewing/editing. Undefined until they pick one, in
  // which case the first page is shown — so opening a Document selects page 1.
  const [selectedPageId, setSelectedPageId] = useState<string | undefined>(undefined)
  // PDF export: a discriminated union so idle / preparing / error can't combine
  // into an impossible state. Mirrors the `ExportOutcome` shape export returns.
  const [exportState, setExportState] = useState<ExportState>({ status: 'idle' })

  // The explicitly selected page, else the first page. `doc` is the single source
  // of truth (reactive); edits from PagePane flow back through the store.
  const selectedPage = doc?.pages.find((p) => p.id === selectedPageId) ?? doc?.pages[0]
  // Index of the shown page in document order — drives the move-up/down enables.
  const selectedPageIndex = doc?.pages.findIndex((p) => p.id === selectedPage?.id) ?? -1

  /** Remove a single Page. Its source/flat/enhanced files are reclaimed; if it
   *  was the last Page the whole Document is deleted and we return to the
   *  library (no empty Documents). The selection falls back to the page now
   *  sitting at the deleted slot — the next one, or the previous if it was last
   *  — so the view never lands on a blank/broken state. Persisted through the
   *  store first; the selection only updates on success, so a failed remove
   *  leaves the UI matching storage. */
  async function handleDeletePage(pageId: string): Promise<void> {
    const current = doc
    if (!current) return
    const deletedIndex = current.pages.findIndex((p) => p.id === pageId)
    if (deletedIndex === -1) return
    try {
      await documentStore.removePage(docId, pageId)
    } catch {
      return
    }
    const remaining = current.pages.filter((p) => p.id !== pageId)
    if (remaining.length === 0) {
      onBack()
      return
    }
    setSelectedPageId(remaining[Math.min(deletedIndex, remaining.length - 1)].id)
  }

  /** Move the selected Page one slot earlier (`dir = -1`) or later (`dir = 1`).
   *  Persisted through the store; the snapshot re-renders in the new order. The
   *  selection stays on the moved Page (its id is unchanged), so the view follows
   *  it to its new position. No-op at the ends. */
  async function handleMovePage(pageId: string, dir: -1 | 1): Promise<void> {
    const current = doc
    if (!current) return
    const from = current.pages.findIndex((p) => p.id === pageId)
    if (from === -1) return
    const to = from + dir
    if (to < 0 || to >= current.pages.length) return
    try {
      await documentStore.movePage(docId, from, to)
    } catch {
      return
    }
  }

  /** Export the Document to a multi-page PDF. Any page not yet materialised is
   *  prepared first (the worker runs its flatten/enhance through the store), so
   *  the PDF always reflects the chosen look; the file is then shared on mobile
   *  or downloaded. The store reflects the freshly-materialised pages into the
   *  snapshot, so no re-read is needed afterwards. */
  async function handleExport(): Promise<void> {
    if (!doc || exportState.status === 'exporting') return
    setExportState({ status: 'exporting' })
    const outcome = await exportDocument(docId)
    setExportState(outcome.ok ? { status: 'idle' } : { status: 'error', message: outcome.error })
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
          <PagePane key={selectedPage.id} docId={doc.id} page={selectedPage} />
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
            await documentStore.removeDocument(docId)
            onBack()
          }}
        >
          Удалить документ
        </Button>
      </Stack>
    </ScreenShell>
  )
}
