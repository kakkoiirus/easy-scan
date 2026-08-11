import { Button, Paper, Stack, Text, Title, UnstyledButton } from '@mantine/core'
import { useDocuments } from '../storage/document-store'
import { DevBar } from './DevBar'
import { ScreenShell } from './ScreenShell'

interface LibraryScreenProps {
  onOpenCamera: () => void
  onOpenDocument: (id: string) => void
}

export function LibraryScreen({ onOpenCamera, onOpenDocument }: LibraryScreenProps) {
  const docs = useDocuments()

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

      {import.meta.env.DEV && <DevBar />}
    </ScreenShell>
  )
}
