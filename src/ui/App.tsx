import { useCallback, useState } from 'react'
import { CameraScreen } from './CameraScreen'
import { DocumentScreen } from './DocumentScreen'
import { LibraryScreen } from './LibraryScreen'

// Minimal screen state machine — no router lib for two-and-a-half screens.
// Discriminated union keeps navigation typesafe. The camera has two explicit
// modes: `new` (capture a fresh Document) and `append` (add pages to an existing
// Document, bound to its id) — splitting the variant on `mode` keeps the
// append-only-in-append-mode rule exhaustive at the type level.
type Screen =
  | { readonly name: 'library' }
  | { readonly name: 'camera'; readonly mode: 'new' }
  | { readonly name: 'camera'; readonly mode: 'append'; readonly docId: string }
  | { readonly name: 'document'; readonly docId: string }

export function App() {
  const [screen, setScreen] = useState<Screen>({ name: 'library' })
  const go = useCallback((next: Screen) => setScreen(next), [])

  return (
    <div className="app">
      {screen.name === 'library' && (
        <LibraryScreen
          onOpenCamera={() => go({ name: 'camera', mode: 'new' })}
          onOpenDocument={(docId) => go({ name: 'document', docId })}
        />
      )}
      {screen.name === 'camera' && (
        <CameraScreen
          docId={screen.mode === 'append' ? screen.docId : undefined}
          // Whether the user finished saving or cancelled, the camera returns to
          // where it was opened from: the Document in append mode, the library
          // in new mode. (The unmount stops the camera in both cases.)
          onBack={() =>
            go(
              screen.mode === 'append'
                ? { name: 'document', docId: screen.docId }
                : { name: 'library' },
            )
          }
        />
      )}
      {screen.name === 'document' && (
        <DocumentScreen
          docId={screen.docId}
          onBack={() => go({ name: 'library' })}
          onAddPage={() => go({ name: 'camera', mode: 'append', docId: screen.docId })}
        />
      )}
    </div>
  )
}
