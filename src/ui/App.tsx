import { useCallback, useState } from 'react'
import { CameraScreen } from './CameraScreen'
import { DocumentScreen } from './DocumentScreen'
import { LibraryScreen } from './LibraryScreen'

// Minimal screen state machine — no router lib for two-and-a-half screens.
// Discriminated union keeps navigation typesafe.
type Screen =
  | { readonly name: 'library' }
  | { readonly name: 'camera' }
  | { readonly name: 'document'; readonly docId: string }

export function App() {
  const [screen, setScreen] = useState<Screen>({ name: 'library' })
  const go = useCallback((next: Screen) => setScreen(next), [])

  return (
    <div className="app">
      {screen.name === 'library' && (
        <LibraryScreen
          onOpenCamera={() => go({ name: 'camera' })}
          onOpenDocument={(docId) => go({ name: 'document', docId })}
        />
      )}
      {screen.name === 'camera' && <CameraScreen onBack={() => go({ name: 'library' })} />}
      {screen.name === 'document' && (
        <DocumentScreen docId={screen.docId} onBack={() => go({ name: 'library' })} />
      )}
    </div>
  )
}
