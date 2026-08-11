import { describe, expect, it } from 'vitest'
import { initialState, isPrompting, reduce } from './reducer'
import type { BackNavState } from './reducer'

// Transitions of the pure back-navigation reducer (./reducer.ts) — the single
// automated seam of the feature (see .scratch/back-gesture/spec.md). Every
// decision (navigate vs prompt vs block vs dedup, and the confirm lifecycle) is
// asserted here with no DOM, no React, no window.history.

const idle: BackNavState = { status: 'idle' }
const prompting: BackNavState = { status: 'prompting' }

describe('initialState', () => {
  it('is idle and not prompting', () => {
    expect(initialState).toEqual({ status: 'idle' })
    expect(isPrompting(initialState)).toBe(false)
  })
})

describe('isPrompting', () => {
  it('is true only for the prompting status', () => {
    expect(isPrompting(prompting)).toBe(true)
    expect(isPrompting(idle)).toBe(false)
  })
})

describe('BackPressed', () => {
  it('navigates from the library (root) with no prompt', () => {
    const r = reduce(idle, {
      type: 'BackPressed',
      screen: 'library',
      hasUnsaved: false,
      saving: false,
    })
    expect(r.state).toEqual({ status: 'idle' })
    expect(r.navigate).toBe(true)
    expect(isPrompting(r.state)).toBe(false)
  })

  it('navigates from the document screen with no prompt (edits persist live)', () => {
    const r = reduce(idle, {
      type: 'BackPressed',
      screen: 'document',
      // document is always navigable — hasUnsaved is irrelevant.
      hasUnsaved: true,
      saving: false,
    })
    expect(r.state).toEqual({ status: 'idle' })
    expect(r.navigate).toBe(true)
    expect(isPrompting(r.state)).toBe(false)
  })

  it('navigates from a new camera with no unsaved pages (empty session)', () => {
    const r = reduce(idle, {
      type: 'BackPressed',
      screen: 'camera-new',
      hasUnsaved: false,
      saving: false,
    })
    expect(r.state).toEqual({ status: 'idle' })
    expect(r.navigate).toBe(true)
    expect(isPrompting(r.state)).toBe(false)
  })

  it('navigates from an append camera with no unsaved pages', () => {
    const r = reduce(idle, {
      type: 'BackPressed',
      screen: 'camera-append',
      hasUnsaved: false,
      saving: false,
    })
    expect(r.state).toEqual({ status: 'idle' })
    expect(r.navigate).toBe(true)
  })

  it('prompts on a new camera with unsaved pages, from idle (no navigate)', () => {
    const r = reduce(idle, {
      type: 'BackPressed',
      screen: 'camera-new',
      hasUnsaved: true,
      saving: false,
    })
    expect(r.state).toEqual({ status: 'prompting' })
    expect(r.navigate).toBe(false)
    expect(isPrompting(r.state)).toBe(true)
  })

  it('prompts on an append camera with unsaved pages, from idle', () => {
    const r = reduce(idle, {
      type: 'BackPressed',
      screen: 'camera-append',
      hasUnsaved: true,
      saving: false,
    })
    expect(r.state).toEqual({ status: 'prompting' })
    expect(r.navigate).toBe(false)
  })

  it('dedups a repeat back while already prompting — no second dialog, no navigate', () => {
    const r = reduce(prompting, {
      type: 'BackPressed',
      screen: 'camera-new',
      hasUnsaved: true,
      saving: false,
    })
    expect(r.state).toEqual({ status: 'prompting' })
    expect(r.navigate).toBe(false)
  })

  it('is blocked while saving, from idle — persistence is not interrupted', () => {
    const r = reduce(idle, {
      type: 'BackPressed',
      screen: 'camera-new',
      hasUnsaved: true,
      saving: true,
    })
    expect(r.state).toEqual({ status: 'idle' })
    expect(r.navigate).toBe(false)
    expect(isPrompting(r.state)).toBe(false)
  })

  it('is blocked while saving even if a confirm were up — unchanged, no navigate', () => {
    const r = reduce(prompting, {
      type: 'BackPressed',
      screen: 'camera-new',
      hasUnsaved: true,
      saving: true,
    })
    expect(r.state).toEqual({ status: 'prompting' })
    expect(r.navigate).toBe(false)
  })

  it('treats an empty camera session as instantly navigable even though saving is false', () => {
    // Guards the boundary: no unsaved + not saving => leave, regardless of screen variant.
    const r = reduce(prompting, {
      type: 'BackPressed',
      screen: 'camera-append',
      hasUnsaved: false,
      saving: false,
    })
    expect(r.state).toEqual({ status: 'idle' })
    expect(r.navigate).toBe(true)
  })
})

describe('ConfirmDiscard', () => {
  it('discards the batch and leaves: prompting → idle, navigate', () => {
    const r = reduce(prompting, { type: 'ConfirmDiscard' })
    expect(r.state).toEqual({ status: 'idle' })
    expect(r.navigate).toBe(true)
    expect(isPrompting(r.state)).toBe(false)
  })

  it('is a no-op from idle (no confirm was up)', () => {
    const r = reduce(idle, { type: 'ConfirmDiscard' })
    expect(r.state).toEqual({ status: 'idle' })
    expect(r.navigate).toBe(false)
  })
})

describe('CancelDiscard', () => {
  it('keeps the batch and stays: prompting → idle, no navigate', () => {
    const r = reduce(prompting, { type: 'CancelDiscard' })
    expect(r.state).toEqual({ status: 'idle' })
    expect(r.navigate).toBe(false)
    expect(isPrompting(r.state)).toBe(false)
  })

  it('is a no-op from idle', () => {
    const r = reduce(idle, { type: 'CancelDiscard' })
    expect(r.state).toEqual({ status: 'idle' })
    expect(r.navigate).toBe(false)
  })
})
