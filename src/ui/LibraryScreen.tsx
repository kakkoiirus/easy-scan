import { Button, Paper, Stack, Text, Title, UnstyledButton } from '@mantine/core'
import { useState } from 'react'
import { documentStore, useDocuments } from '../storage/document-store'
import type { Bytes } from '../types'
import { ScreenShell } from './ScreenShell'

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
    <ScreenShell
      title="Документы"
      action={
        <Button variant="subtle" size="sm" onClick={onOpenCamera}>
          Камера
        </Button>
      }
    >
      {docs.length === 0 ? (
        <Stack align="center" justify="center" gap="xs" mih="55vh">
          <Title order={5} fw={500}>
            Пока пусто
          </Title>
          <Text size="sm" c="dimmed" ta="center">
            Отсканируйте первый документ камерой.
          </Text>
          <Button mt="xs" onClick={onOpenCamera}>
            Сканировать
          </Button>
        </Stack>
      ) : (
        <Stack gap="sm">
          {docs.map((d) => (
            <UnstyledButton key={d.id} onClick={() => onOpenDocument(d.id)} w="100%">
              <Paper p="md" withBorder w="100%">
                <Stack gap={2}>
                  <Text fw={500} size="sm">
                    {d.title}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {d.pageCount} стр. · {new Date(d.createdAt).toLocaleDateString()}
                  </Text>
                </Stack>
              </Paper>
            </UnstyledButton>
          ))}
        </Stack>
      )}

      <div className="devbar">
        <Button variant="light" size="xs" onClick={handleDemo} loading={busy}>
          ＋ Демо-документ
        </Button>
        <Text size="xs" c="dimmed">
          dev: проверка OPFS-хранилища
        </Text>
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
