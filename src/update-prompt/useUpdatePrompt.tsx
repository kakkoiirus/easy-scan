import { useEffect, useRef } from 'react'
import { Button, Group } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { initialState, isVisible, reduce } from './reducer'
import type { UpdateEvent, UpdateState } from './reducer'

// Impure shell around the pure `reducer` (see .scratch/app-update/spec.md): it
// owns the service-worker registration, the Mantine toast, the visibility
// re-check, and the reload — every *decision* still runs through the reducer.
// Not unit-tested, like the repo's other impure services (camera-controller,
// corner-editor, loupe, cv-client): the SW + notifications context can't be
// exercised meaningfully without a real worker.
//
// State lives in a ref, not React state, because `useRegisterSW` captures its
// callbacks ONCE (lazy useState init) and never re-reads them — so the handlers
// close over the first render's scope. Refs keep that closure correct across
// re-renders without triggering renders of our own (the toast is imperative).

/** Stable id so a repeat need-refresh replaces the toast instead of stacking. */
const UPDATE_TOAST_ID = 'easy-scan-update'

/**
 * Surface the sticky «Доступна новая версия» toast whenever the service worker
 * has a waiting (newer) bundle, and let the user choose when to apply it.
 * Render once, at the App root, inside the Mantine notifications context.
 */
export function useUpdatePrompt(): void {
  const stateRef = useRef<UpdateState>(initialState)
  // Cleanup for the visibilitychange listener added in `onRegisteredSW`.
  const cleanupRef = useRef<(() => void) | null>(null)
  // `useRegisterSW`'s `updateServiceWorker` is created once and stable, but we
  // route through a ref so `accept` always reads the live binding.
  const updateSwRef = useRef<(reloadPage?: boolean) => Promise<void>>(
    () => Promise.resolve(),
  )

  const hideToast = (): void => {
    notifications.hide(UPDATE_TOAST_ID)
  }

  // Advance the reducer by one event, store the result, and return it. Every
  // handler routes through here so the ref stays the single source of truth.
  const apply = (event: UpdateEvent): UpdateState => {
    const next = reduce(stateRef.current, event)
    stateRef.current = next
    return next
  }

  const showToast = (): void => {
    notifications.show({
      id: UPDATE_TOAST_ID,
      title: 'Доступна новая версия',
      message: (
        <Group gap="xs" mt={4}>
          <Button size="xs" onClick={accept}>
            Обновить
          </Button>
          <Button size="xs" variant="subtle" onClick={dismiss}>
            Позже
          </Button>
        </Group>
      ),
      // Sticky by design — never auto-vanish; only the buttons hide it.
      autoClose: false,
      // «Позже» is the only dismiss path, so the reducer stays the single
      // source of truth for whether the toast is shown.
      withCloseButton: false,
    })
  }

  /** «Обновить»: hide the toast, activate the waiting SW (which reloads), and
   *  resurface the toast for retry if activation rejects. */
  const accept = (): void => {
    apply({ type: 'Accept' })
    hideToast()
    void updateSwRef.current(true).catch(() => {
      if (isVisible(apply({ type: 'UpdateFailed' }))) showToast()
    })
  }

  /** «Позже»: hide the toast for the rest of this session. */
  const dismiss = (): void => {
    apply({ type: 'Dismiss' })
    hideToast()
  }

  const { updateServiceWorker } = useRegisterSW({
    onNeedRefresh: () => {
      if (isVisible(apply({ type: 'NeedRefresh' }))) showToast()
    },
    onRegisterError: (error) => {
      console.error('[pwa] service worker registration failed', error)
    },
    onRegisteredSW: (_swScriptUrl, registration) => {
      if (!registration) return
      // Re-check the origin when the user returns to the tab, so a deploy that
      // landed while away is surfaced. Load-time checks are done by the
      // registration itself. Swallow rejections (e.g. offline) so offline use
      // stays quiet.
      const onVisibilityChange = (): void => {
        if (document.visibilityState === 'visible') {
          registration.update().catch(() => {})
        }
      }
      document.addEventListener('visibilitychange', onVisibilityChange)
      cleanupRef.current = () => {
        document.removeEventListener('visibilitychange', onVisibilityChange)
      }
    },
  })
  updateSwRef.current = updateServiceWorker

  useEffect(() => {
    return () => {
      cleanupRef.current?.()
    }
  }, [])
}

/** Null-rendering wrapper so the hook mounts once, at the App root. */
export function UpdatePrompt(): null {
  useUpdatePrompt()
  return null
}
