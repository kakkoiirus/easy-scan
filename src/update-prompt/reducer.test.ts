import { describe, expect, it } from 'vitest'
import { initialState, isVisible, reduce } from './reducer'
import type { UpdateState } from './reducer'

// Transitions of the pure update-prompt reducer (./reducer.ts) — the single
// automated seam of the feature (see .scratch/app-update/spec.md).

const idle: UpdateState = { status: 'idle' }
const available: UpdateState = { status: 'available' }
const suppressed: UpdateState = { status: 'suppressed' }
const updating: UpdateState = { status: 'updating' }

describe('initialState', () => {
  it('is idle and not visible', () => {
    expect(initialState).toEqual({ status: 'idle' })
    expect(isVisible(initialState)).toBe(false)
  })
})

describe('NeedRefresh', () => {
  it('shows the toast from idle', () => {
    const next = reduce(idle, { type: 'NeedRefresh' })
    expect(next).toEqual({ status: 'available' })
    expect(isVisible(next)).toBe(true)
  })

  it('is a dedup no-op when already available (no second toast)', () => {
    expect(reduce(available, { type: 'NeedRefresh' })).toEqual({ status: 'available' })
  })

  it('stays suppressed — a session-snooze hides subsequent deploys too', () => {
    const next = reduce(suppressed, { type: 'NeedRefresh' })
    expect(next).toEqual({ status: 'suppressed' })
    expect(isVisible(next)).toBe(false)
  })

  it('does not resurface while a reload is in flight', () => {
    const next = reduce(updating, { type: 'NeedRefresh' })
    expect(next).toEqual({ status: 'updating' })
    expect(isVisible(next)).toBe(false)
  })
})

describe('Accept', () => {
  it('hides the toast and starts the reload from available', () => {
    const next = reduce(available, { type: 'Accept' })
    expect(next).toEqual({ status: 'updating' })
    expect(isVisible(next)).toBe(false)
  })

  it('is a no-op from idle', () => {
    expect(reduce(idle, { type: 'Accept' })).toEqual({ status: 'idle' })
  })

  it('is a no-op from suppressed', () => {
    expect(reduce(suppressed, { type: 'Accept' })).toEqual({ status: 'suppressed' })
  })

  it('is a no-op while already updating', () => {
    expect(reduce(updating, { type: 'Accept' })).toEqual({ status: 'updating' })
  })
})

describe('Dismiss', () => {
  it('hides the toast for the rest of the session from available', () => {
    const next = reduce(available, { type: 'Dismiss' })
    expect(next).toEqual({ status: 'suppressed' })
    expect(isVisible(next)).toBe(false)
  })

  it('is a no-op from idle', () => {
    expect(reduce(idle, { type: 'Dismiss' })).toEqual({ status: 'idle' })
  })

  it('is a no-op from suppressed', () => {
    expect(reduce(suppressed, { type: 'Dismiss' })).toEqual({ status: 'suppressed' })
  })

  it('is a no-op while updating', () => {
    expect(reduce(updating, { type: 'Dismiss' })).toEqual({ status: 'updating' })
  })
})

describe('UpdateFailed', () => {
  it('surfaces the toast again for retry after a failed reload', () => {
    const next = reduce(updating, { type: 'UpdateFailed' })
    expect(next).toEqual({ status: 'available' })
    expect(isVisible(next)).toBe(true)
  })

  it('is a no-op when nothing is being updated', () => {
    expect(reduce(idle, { type: 'UpdateFailed' })).toEqual({ status: 'idle' })
    expect(reduce(available, { type: 'UpdateFailed' })).toEqual({ status: 'available' })
    expect(reduce(suppressed, { type: 'UpdateFailed' })).toEqual({ status: 'suppressed' })
  })
})
