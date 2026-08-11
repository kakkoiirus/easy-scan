// Pure reducer for the app-update prompt — the testable seam of the otherwise
// service-worker/notifications-bound feature (see .scratch/app-update/spec.md).
// Every decision in the feature lives here: dedup a repeat need-refresh,
// session-snooze a dismiss, retry after a failed reload, and never resurface an
// update mid-reload. Discriminated unions on `status` / `type` (CLAUDE.md:
// prefer discriminated unions for state and messages).

/** Whether the update toast should be on screen. */
export type UpdateState =
  | { readonly status: 'idle' } // nothing to show yet
  | { readonly status: 'available' } // toast visible
  | { readonly status: 'suppressed' } // dismissed this session — stay quiet
  | { readonly status: 'updating' } // reload in flight, toast hidden

/** A single signal from the service worker or the user. */
export type UpdateEvent =
  | { readonly type: 'NeedRefresh' } // the SW has a waiting, newer bundle
  | { readonly type: 'Accept' } // user tapped «Обновить»
  | { readonly type: 'Dismiss' } // user tapped «Позже»
  | { readonly type: 'UpdateFailed' } // activation/reload rejected — allow retry

/** Nothing to show yet. */
export const initialState: UpdateState = { status: 'idle' }

/** Should the toast be shown? Drives the Mantine show/hide. */
export function isVisible(state: UpdateState): boolean {
  return state.status === 'available'
}

/**
 * Advance the update-prompt state by one event. Transitions:
 * - `NeedRefresh`: idle → available (show); no-op otherwise — available dedups
 *   (no second toast), suppressed stays a session-snooze, updating isn't interrupted.
 * - `Accept`: available → updating (hide + reload); no-op otherwise.
 * - `Dismiss`: available → suppressed (hide for the session); no-op otherwise.
 * - `UpdateFailed`: updating → available (retry); no-op otherwise.
 */
export function reduce(state: UpdateState, event: UpdateEvent): UpdateState {
  switch (event.type) {
    case 'NeedRefresh':
      return state.status === 'idle' ? { status: 'available' } : state
    case 'Accept':
      return state.status === 'available' ? { status: 'updating' } : state
    case 'Dismiss':
      return state.status === 'available' ? { status: 'suppressed' } : state
    case 'UpdateFailed':
      return state.status === 'updating' ? { status: 'available' } : state
  }
}
