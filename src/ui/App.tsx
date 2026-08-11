import { useCallback, useRef, useState } from 'react'
import { useBackHandler, type CameraSnapshot } from '../back-nav/useBackHandler'
import type { BackScreen } from '../back-nav/reducer'
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

/** Collapse the current screen to the variants the back decision cares about
 *  (the reducer's `BackScreen`). `camera-new` and `camera-append` stay distinct
 *  only so `backTarget` can route the leave to the right place. */
function backScreenOf(screen: Screen): BackScreen {
  switch (screen.name) {
    case 'library':
      return 'library'
    case 'document':
      return 'document'
    case 'camera':
      return screen.mode === 'append' ? 'camera-append' : 'camera-new'
  }
}

/** The screen one level up — the target of every back navigation, whether the
 *  gesture (via `useBackHandler`) or an on-screen button. Append-camera returns
 *  to its Document; new-camera and document return to the library. */
function backTarget(screen: Screen): Screen {
  if (screen.name === 'camera' && screen.mode === 'append')
    return { name: 'document', docId: screen.docId }
  return { name: 'library' }
}

export function App() {
  const [screen, setScreen] = useState<Screen>({ name: 'library' })
  const go = useCallback((next: Screen) => setScreen(next), [])

  // The camera pushes its unsaved-batch snapshot here; the back handler reads it
  // on `popstate` to decide prompt vs navigate. Held at the App root so the
  // camera (which owns the state) and the handler (which reads it) share one ref.
  const cameraSnapshotRef = useRef<CameraSnapshot>({ unsavedCount: 0, saving: false })
  const registerCameraSnapshot = useCallback((snapshot: CameraSnapshot) => {
    cameraSnapshotRef.current = snapshot
  }, [])
  const readCameraSnapshot = useCallback(() => cameraSnapshotRef.current, [])

  // Whether the user finished saving or cancelled, the camera returns to where
  // it was opened from: the Document in append mode, the library in new mode.
  // Document backs out to the library. The back handler calls this same path on
  // a navigate-true gesture (and «Сбросить»), guarding the gesture with the
  // discard confirm; on-screen buttons bypass the guard and navigate directly.
  const onScreenBack = useCallback(() => setScreen(backTarget(screen)), [screen])

  const back = useBackHandler({
    backScreen: backScreenOf(screen),
    onBack: onScreenBack,
    readSnapshot: readCameraSnapshot,
  })

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
          onBack={onScreenBack}
          registerSnapshot={registerCameraSnapshot}
          prompting={back.prompting}
          onConfirmDiscard={back.confirmDiscard}
          onCancelDiscard={back.cancelDiscard}
        />
      )}
      {screen.name === 'document' && (
        <DocumentScreen
          docId={screen.docId}
          onBack={onScreenBack}
          onAddPage={() => go({ name: 'camera', mode: 'append', docId: screen.docId })}
        />
      )}
    </div>
  )
}
