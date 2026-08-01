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
        <button className="btn btn--ghost" onClick={onBack}>
          Назад
        </button>
      }
    >
      <div className="doc-view">
        {thumbUrl ? (
          <img className="thumb" src={thumbUrl} alt={doc?.title} />
        ) : (
          <div className="thumb thumb--placeholder">нет превью</div>
        )}
        <p className="muted">{doc ? `${doc.pages.length} стр.` : 'загрузка…'}</p>
        <button
          className="btn btn--danger"
          disabled={!doc}
          onClick={async () => {
            await removeDocument(docId)
            onBack()
          }}
        >
          Удалить
        </button>
        <p className="muted">Экспорт в PDF — этап M7.</p>
      </div>
    </ScreenShell>
  )
}
