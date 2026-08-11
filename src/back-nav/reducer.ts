// Pure reducer for the back-gesture navigation feature — the testable seam of an
// otherwise window.history/popstate-bound feature (see .scratch/back-gesture/
// spec.md). Every *decision* lives here: navigate vs prompt vs block vs dedup,
// and the confirm lifecycle. Discriminated unions on `status` / `type`
// (CLAUDE.md: prefer discriminated unions for state and messages).

/** The screen the user is on, collapsed to the cases the back decision cares
 *  about. The two camera variants mirror the camera's `new`/`append` modes; the
 *  reducer treats them alike because the discard guard is mode-agnostic — an
 *  appended batch is discarded the same way as a fresh one — and `onBack`
 *  routing lives in `App` on the full `Screen`, not on this type. */
export type BackScreen = 'library' | 'document' | 'camera-new' | 'camera-append'

/** Whether the discard confirm is on screen. */
export type BackNavState =
  | { readonly status: 'idle' } // no confirm; a back gesture navigates (per the rules below)
  | { readonly status: 'prompting' } // confirm visible — back pressed with unsaved Pages

/** A back gesture or a confirm-dialog choice. */
export type BackNavEvent =
  | {
      readonly type: 'BackPressed'
      readonly screen: BackScreen
      /** Are there captured pages in flight (not yet saved via «Готово»)? */
      readonly hasUnsaved: boolean
      /** Is «Готово» mid-write right now? */
      readonly saving: boolean
    }
  | { readonly type: 'ConfirmDiscard' } // user tapped «Сбросить»
  | { readonly type: 'CancelDiscard' } // user tapped «Продолжить скан»

/** The outcome of one transition: the next state and whether the hook should
 *  navigate (call `onBack`). The `navigate` flag is event-driven, so it rides
 *  on the transition rather than being derivable from state alone. */
export interface BackNavResult {
  readonly state: BackNavState
  readonly navigate: boolean
}

/** No confirm showing. */
export const initialState: BackNavState = { status: 'idle' }

/** Should the discard confirm be shown? Drives the Mantine Modal. */
export function isPrompting(state: BackNavState): boolean {
  return state.status === 'prompting'
}

/**
 * Advance the back-nav state by one event. Transitions:
 * - `BackPressed`:
 *   - while `saving` → unchanged, no navigate (a mid-write back never interrupts persistence);
 *   - on `library`/`document`, or on a camera with no unsaved Pages → idle, navigate
 *     (document edits persist live so nothing is lost; an empty camera session backs out instantly);
 *   - on a camera with unsaved Pages, from `idle` → prompting, no navigate (ask first);
 *   - on a camera with unsaved Pages, already `prompting` → unchanged (dedup — one confirm at a time).
 * - `ConfirmDiscard`: prompting → idle, navigate (discard the batch and leave); no-op otherwise.
 * - `CancelDiscard`: prompting → idle, no navigate (stay, batch intact); no-op otherwise.
 */
export function reduce(state: BackNavState, event: BackNavEvent): BackNavResult {
  switch (event.type) {
    case 'BackPressed':
      return reduceBackPressed(state, event)
    case 'ConfirmDiscard':
      return state.status === 'prompting'
        ? { state: { status: 'idle' }, navigate: true }
        : { state, navigate: false }
    case 'CancelDiscard':
      return state.status === 'prompting'
        ? { state: { status: 'idle' }, navigate: false }
        : { state, navigate: false }
  }
}

function reduceBackPressed(
  state: BackNavState,
  event: Extract<BackNavEvent, { readonly type: 'BackPressed' }>,
): BackNavResult {
  // Mid-save: never prompt, never leave — persistence must finish uninterrupted.
  if (event.saving) return { state, navigate: false }
  // Root and document are always navigable: the library is the honest exit, and
  // document edits persist live so back loses nothing.
  if (event.screen === 'library' || event.screen === 'document')
    return { state: { status: 'idle' }, navigate: true }
  // Camera (new or append): an empty session backs out instantly; an unsaved
  // batch prompts once.
  if (!event.hasUnsaved) return { state: { status: 'idle' }, navigate: true }
  if (state.status === 'prompting') return { state, navigate: false } // dedup
  return { state: { status: 'prompting' }, navigate: false }
}
