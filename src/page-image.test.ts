import { describe, expect, it } from 'vitest'
import type { Page, Quad } from './types'
import { bestImageFile, bestPageImage } from './page-image'

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

// bestPageImage is what export reads: the same enhanced → flat → source rule as
// bestImageFile, but also carrying the recorded pixel dimensions for the flat
// and enhanced results (the source has none — its dims are read from the bytes).

describe('bestPageImage', () => {
  it('picks the enhanced image and carries its dimensions', () => {
    const page = makePage({
      flat: { file: 'documents/d/p.flat.jpg', width: 10, height: 8 },
      enhanced: { file: 'documents/d/p.enh.jpg', width: 10, height: 8 },
    })

    expect(bestPageImage(page)).toEqual({
      file: 'documents/d/p.enh.jpg',
      width: 10,
      height: 8,
    })
  })

  it('falls back to the flat image (with its dimensions) when no enhanced exists', () => {
    const page = makePage({ flat: { file: 'documents/d/p.flat.jpg', width: 12, height: 6 } })

    expect(bestPageImage(page)).toEqual({ file: 'documents/d/p.flat.jpg', width: 12, height: 6 })
  })

  it('falls back to the source photo with no recorded dimensions', () => {
    // The source photo carries no dims on the Page; export reads them from the
    // JPEG bytes via jpegDimensions when it lands here.
    expect(bestPageImage(makePage())).toEqual({ file: 'documents/d/p.jpg' })
  })
})
