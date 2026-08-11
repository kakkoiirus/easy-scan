import { Button, Text } from '@mantine/core'
import { useState } from 'react'
import { documentStore } from '../storage/document-store'
import type { Bytes } from '../types'

/**
 * Dev-only bar: drops a fake single-page Document into OPFS to exercise the
 * storage path without the camera. Rendered under `import.meta.env.DEV` — and
 * the gate must sit at the *import site* (LibraryScreen), not inside this
 * component, so the whole module tree-shakes out of the production bundle.
 */
export function DevBar() {
  const [busy, setBusy] = useState(false)

  async function handleDemo(): Promise<void> {
    setBusy(true)
    try {
      const { bytes, width, height } = await renderDemoPage()
      await documentStore.createSinglePageDocument(`Демо · ${new Date().toLocaleTimeString()}`, {
        bytes,
        width,
        height,
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="devbar">
      <Button variant="light" size="xs" onClick={handleDemo} loading={busy}>
        ＋ Демо-документ
      </Button>
      <Text size="xs" c="dimmed">
        dev: проверка OPFS-хранилища
      </Text>
    </div>
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
