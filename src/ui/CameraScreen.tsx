import { Button, Stack, Text, Title } from '@mantine/core'
import { useEffect, useState } from 'react'
import { cvClient } from '../worker/cv-client'
import { ScreenShell } from './ScreenShell'

interface CameraScreenProps {
  onBack: () => void
}

export function CameraScreen({ onBack }: CameraScreenProps) {
  const [status, setStatus] = useState('не проверен')

  useEffect(() => {
    let cancelled = false
    cvClient
      .ping()
      .then(() => {
        if (!cancelled) setStatus('воркер отвечает ✓')
      })
      .catch(() => {
        if (!cancelled) setStatus('воркер недоступен')
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <ScreenShell
      title="Камера"
      action={
        <Button variant="subtle" size="sm" onClick={onBack}>
          Назад
        </Button>
      }
    >
      <Stack align="center" justify="center" gap="xs" mih="60vh">
        <Text style={{ fontSize: 48 }}>📷</Text>
        <Title order={5}>Камера — этап M1</Title>
        <Text size="sm" c="dimmed" ta="center">
          Здесь будет видеопоток и захват стоп-кадра.
        </Text>
        <Text size="xs" c="dimmed">
          {status}
        </Text>
      </Stack>
    </ScreenShell>
  )
}
