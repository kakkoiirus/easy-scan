import { useState } from 'react'
import { createDemoDocument, useDocuments } from '../storage/useDocuments'
import { ScreenShell } from './ScreenShell'
import type { Bytes } from '../types'

interface LibraryScreenProps {
  onOpenCamera: () => void
  onOpenDocument: (id: string) => void
}

export function LibraryScreen({ onOpenCamera, onOpenDocument }: LibraryScreenProps) {
  const docs = useDocuments()
  const [busy, setBusy] = useState(false)

  async function handleDemo(): Promise<void> {
    setBusy(true)
    try {
      const { bytes, width, height } = await renderDemoPage()
      await createDemoDocument(`Демо · ${new Date().toLocaleTimeString()}`, bytes, width, height)
    } finally {
      setBusy(false)
    }
  }

  return (
    <ScreenShell
      title="Документы"
      action={
        <button className="btn btn--ghost" onClick={onOpenCamera}>
          Камера
        </button>
      }
    >
      {docs.length === 0 ? (
        <div className="empty">
          <p className="empty__title">Пока пусто</p>
          <p className="empty__hint">Отсканируйте первый документ камерой.</p>
          <button className="btn btn--primary" onClick={onOpenCamera}>
            Сканировать
          </button>
        </div>
      ) : (
        <ul className="doc-list">
          {docs.map((d) => (
            <li key={d.id}>
              <button className="doc-row" onClick={() => onOpenDocument(d.id)}>
                <span className="doc-row__title">{d.title}</span>
                <span className="doc-row__meta">
                  {d.pageCount} стр. · {new Date(d.createdAt).toLocaleDateString()}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="devbar">
        <button className="btn btn--ghost" onClick={handleDemo} disabled={busy}>
          {busy ? 'Создаю…' : '＋ Демо-документ'}
        </button>
        <span className="devbar__hint">dev: проверка OPFS-хранилища</span>
      </div>
    </ScreenShell>
  )
}

/** Draws a fake page to JPEG bytes — only used by the dev demo button. */
async function renderDemoPage(): Promise<{ bytes: Bytes; width: number; height: number }> {
  const width = 1240
  const height = 1754
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2d context unavailable')

  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)
  ctx.fillStyle = '#0b0d12'
  ctx.font = '48px system-ui, sans-serif'
  ctx.fillText('Demo page', 80, 120)
  ctx.fillRect(80, 170, width - 160, 4)
  ctx.fillStyle = '#9aa3b2'
  ctx.font = '34px system-ui, sans-serif'
  for (let i = 0; i < 18; i += 1) {
    ctx.fillText('Lorem ipsum dolor sit amet, consectetur adipiscing elit.', 80, 250 + i * 60)
  }

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/jpeg', 0.85)
  })
  return { bytes: new Uint8Array(await blob.arrayBuffer()), width, height }
}
