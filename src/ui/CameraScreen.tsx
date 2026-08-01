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
        <button className="btn btn--ghost" onClick={onBack}>
          Назад
        </button>
      }
    >
      <div className="placeholder">
        <div className="placeholder__icon">📷</div>
        <p className="placeholder__title">Камера — этап M1</p>
        <p className="placeholder__hint">Здесь будет видеопоток и захват стоп-кадра.</p>
        <p className="muted">{status}</p>
      </div>
    </ScreenShell>
  )
}
