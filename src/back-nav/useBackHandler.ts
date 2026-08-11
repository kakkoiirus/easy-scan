import { useCallback, useEffect, useRef, useState } from 'react'
import { initialState, isPrompting, reduce } from './reducer'
import type { BackNavEvent, BackNavResult, BackNavState, BackScreen } from './reducer'

// Impure shell around the pure `reducer` (see .scratch/back-gesture/spec.md): it
// owns the single global `window.history` stack, the `popstate` listener, and
// the confirm-dialog flag. Every *decision* still runs through the reducer. Not
// unit-tested, like the repo's other impure services (camera-controller,
// corner-editor, loupe, cv-client, useUpdatePrompt): a real browser history
// stack can't be exercised meaningfully under node vitest.
//
// State lives in a ref, not React state, because the `popstate` listener is
// wired once (on mount) and would otherwise close over the first render's
// scope; a `useState` mirror exists only to re-render the confirm Modal.

/** The camera's unsaved-batch snapshot, read by the back handler when a gesture
 *  lands on a camera screen. The camera owns this state; it pushes the snapshot
 *  up via `registerSnapshot`, and the handler reads it synchronously on
 *  `popstate`. `document` needs none — its edits persist live. */
export interface CameraSnapshot {
  /** Pages in flight: stashed session pages + the page under review, if any. */
  readonly unsavedCount: number
  readonly saving: boolean
}

/** Marker carried by the sentinel history entry. The entry holds NO url (the
 *  `url` arg is omitted) — the address bar never moves, so refresh always lands
 *  on `library` (ADR-0005; the Pages subpath has no SPA fallback, ADR-0004). */
const SENTINEL = { easyScanBack: true } as const

interface UseBackHandlerArgs {
  /** The current screen, collapsed to the back-decision variants. */
  readonly backScreen: BackScreen
  /** Navigate one level up — the existing screen `onBack`. Called when the
   *  reducer's `navigate` flag is set (gesture on root/document/empty camera, a
   *  dedup-free camera confirm, or «Сбросить»). */
  readonly onBack: () => void
  /** Read the camera snapshot. Consulted only on camera screens. */
  readonly readSnapshot: () => CameraSnapshot
}

interface UseBackHandlerResult {
  /** Whether the discard confirm Modal should show. */
  readonly prompting: boolean
  /** «Сбросить»: discard the unsaved batch and leave. */
  readonly confirmDiscard: () => void
  /** «Продолжить скан»: keep the batch and stay on the camera. */
  readonly cancelDiscard: () => void
}

/**
 * Mirror the in-app screen stack onto `window.history` so the phone's back
 * gesture drives in-app navigation (ADR-0005). A single sentinel entry is
 * pushed for every non-`library` screen; `popstate` (the gesture) asks the pure
 * `reducer` whether to navigate, prompt to discard, or block, and this hook
 * acts on the answer. Render once, at the App root, inside `MantineProvider`.
 */
export function useBackHandler({
  backScreen,
  onBack,
  readSnapshot,
}: UseBackHandlerArgs): UseBackHandlerResult {
  // Reducer state in a ref (the mount-once popstate listener reads the latest
  // transition through it) plus a useState mirror to drive the Modal render.
  const stateRef = useRef<BackNavState>(initialState)
  const [state, setState] = useState<BackNavState>(initialState)

  // Latest props for the mount-once popstate listener. Written each render so
  // the stable closure always reads the live screen / onBack / snapshot.
  const backScreenRef = useRef(backScreen)
  backScreenRef.current = backScreen
  const onBackRef = useRef(onBack)
  onBackRef.current = onBack
  const readSnapshotRef = useRef(readSnapshot)
  readSnapshotRef.current = readSnapshot

  // History bookkeeping:
  //  `armed`    — a sentinel entry currently sits above the root for this screen.
  //  `disarming`— the next `popstate` is one WE initiated (sentinel cleanup) and
  //               must be swallowed rather than treated as a gesture.
  const armedRef = useRef(false)
  const disarmingRef = useRef(false)

  const apply = useCallback((event: BackNavEvent): BackNavResult => {
    const result = reduce(stateRef.current, event)
    stateRef.current = result.state
    setState(result.state)
    return result
  }, [])

  // Arm/disarm the sentinel as the screen changes, keeping the invariant
  //   armed === (backScreen !== 'library')
  // A non-root screen with no sentinel pushes one. Arriving at the root with a
  // sentinel still up (on-screen back or «Сбросить», which bypass `popstate`)
  // pops it via `history.back()` and flags the resulting popstate to be ignored.
  useEffect(() => {
    if (backScreen === 'library') {
      if (armedRef.current) {
        armedRef.current = false
        disarmingRef.current = true
        window.history.back()
      }
      return
    }
    if (!armedRef.current) {
      window.history.pushState(SENTINEL, '')
      armedRef.current = true
    }
  }, [backScreen])

  // The gesture handler — wired once.
  useEffect(() => {
    const onPopState = (): void => {
      // A popstate we initiated (sentinel cleanup) — swallow it.
      if (disarmingRef.current) {
        disarmingRef.current = false
        return
      }
      const screen = backScreenRef.current
      // The root arms nothing, so any popstate here is a stray forward ghost
      // (a left screen's dead entry resurrected by an accidental forward swipe).
      // Bounce back to the root — never resurrect the screen we left.
      if (screen === 'library') {
        disarmingRef.current = true
        window.history.back()
        return
      }
      const snapshot =
        screen === 'document'
          ? { unsavedCount: 0, saving: false }
          : readSnapshotRef.current()
      const result = apply({
        type: 'BackPressed',
        screen,
        hasUnsaved: snapshot.unsavedCount > 0,
        saving: snapshot.saving,
      })
      // The browser consumed our sentinel to fire this popstate, so re-arm at
      // once — both to stay interceptable when we are staying (prompting, a
      // dedup, or a save-block) AND on a navigate, so a rapid second back has a
      // sentinel to pop before React commits and the screen-change effect runs.
      // pushState truncates any forward entries, so no dead entry resurrects a
      // screen we already left.
      window.history.pushState(SENTINEL, '')
      armedRef.current = true
      if (result.navigate) {
        // Leave. If the new screen is the root, the screen-change effect drops
        // the sentinel we just pushed; otherwise it stays armed for that screen.
        onBackRef.current()
      }
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [apply])

  const confirmDiscard = useCallback(() => {
    const result = apply({ type: 'ConfirmDiscard' })
    if (!result.navigate) return
    // The batch lives in memory in CameraScreen; leaving unmounts and discards
    // it — the same path the on-screen «Отмена» already takes. The screen-change
    // effect pops our sentinel on the way down to the root.
    onBackRef.current()
  }, [apply])

  const cancelDiscard = useCallback(() => {
    // → idle, no navigate. The sentinel we re-armed when prompting stays up, so
    // the gesture still works; only the confirm closes.
    apply({ type: 'CancelDiscard' })
  }, [apply])

  return {
    prompting: isPrompting(state),
    confirmDiscard,
    cancelDiscard,
  }
}
