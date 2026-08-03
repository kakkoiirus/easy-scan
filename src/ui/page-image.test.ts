import { describe, expect, it } from 'vitest'
import type { Page, Quad } from '../types'
import { bestImageFile } from './page-image'

// Fixtures — a Page with optional flat/enhanced results overridden per case.

const QUAD: Quad = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
]

function makePage(over: Partial<Page> = {}): Page {
  return { id: 'p', file: 'documents/d/p.jpg', quad: QUAD, enhanceMode: 'color', ...over }
}

describe('bestImageFile', () => {
  it('prefers the enhanced image when it has materialised', () => {
    const page = makePage({
      flat: { file: 'documents/d/p.flat.jpg', width: 1, height: 1 },
      enhanced: { file: 'documents/d/p.enh.jpg', width: 1, height: 1 },
    })

    expect(bestImageFile(page)).toBe('documents/d/p.enh.jpg')
  })

  it('falls back to the flat image when no enhanced result exists', () => {
    const page = makePage({ flat: { file: 'documents/d/p.flat.jpg', width: 1, height: 1 } })

    expect(bestImageFile(page)).toBe('documents/d/p.flat.jpg')
  })

  it('falls back to the source photo when neither flat nor enhanced exists', () => {
    expect(bestImageFile(makePage())).toBe('documents/d/p.jpg')
  })
})
