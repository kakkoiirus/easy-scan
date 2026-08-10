import { describe, expect, it } from 'vitest'
import type { Document, EnhanceMode, Page, Quad } from './types'
import {
  appendPageToDocument,
  movePageInDocument,
  removePageFromDocument,
  replacePageEnhanced,
  replacePageEnhanceMode,
  replacePageFlat,
  replacePageQuad,
} from './document'

// --- Fixtures ----------------------------------------------------------------

const QUAD: Quad = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 8 },
  { x: 0, y: 8 },
]
const OTHER_QUAD: Quad = [
  { x: 1, y: 1 },
  { x: 9, y: 1 },
  { x: 9, y: 7 },
  { x: 1, y: 7 },
]

function page(id: string): Page {
  return { id, file: `documents/d/${id}.jpg`, quad: QUAD, enhanceMode: 'color' }
}

function doc(id: string, pages: readonly Page[]): Document {
  return { id, title: id, createdAt: 1, pages }
}

// --- Structural transforms ---------------------------------------------------

describe('appendPageToDocument', () => {
  it('appends the page to the end without mutating the source document', () => {
    const original = doc('d1', [page('p1'), page('p2')])

    const next = appendPageToDocument(original, page('p3'))

    expect(next.pages.map((p) => p.id)).toEqual(['p1', 'p2', 'p3'])
    expect(original.pages.map((p) => p.id)).toEqual(['p1', 'p2'])
  })
})

describe('removePageFromDocument', () => {
  it('drops only the target page; siblings (and their flat/enhanced) are intact', () => {
    const p1 = { ...page('p1'), flat: { file: 'documents/d/p1.flat.jpg', width: 1, height: 1 } }
    const p2 = page('p2')
    const p3 = { ...page('p3'), enhanced: { file: 'documents/d/p3.enh.jpg', width: 1, height: 1 } }
    const original = doc('d1', [p1, p2, p3])

    const next = removePageFromDocument(original, 'p2')

    expect(next.pages.map((p) => p.id)).toEqual(['p1', 'p3'])
    expect(next.pages[0]).toEqual(p1)
    expect(next.pages[1]).toEqual(p3)
    expect(original.pages.map((p) => p.id)).toEqual(['p1', 'p2', 'p3'])
  })

  it('is a no-op (returns an equivalent Document) when the page id is absent', () => {
    const original = doc('d1', [page('p1'), page('p2')])

    const next = removePageFromDocument(original, 'missing')

    expect(next.pages.map((p) => p.id)).toEqual(['p1', 'p2'])
  })
})

describe('movePageInDocument', () => {
  it('moves a page earlier without mutating the source Document', () => {
    const original = doc('d1', [page('p1'), page('p2'), page('p3')])

    const next = movePageInDocument(original, 2, 0) // p3 to the front

    expect(next.pages.map((p) => p.id)).toEqual(['p3', 'p1', 'p2'])
    expect(original.pages.map((p) => p.id)).toEqual(['p1', 'p2', 'p3'])
  })

  it('moves a page later', () => {
    const original = doc('d1', [page('p1'), page('p2'), page('p3')])

    const next = movePageInDocument(original, 0, 2) // p1 to the back

    expect(next.pages.map((p) => p.id)).toEqual(['p2', 'p3', 'p1'])
  })

  it('is a no-op when either index is out of range', () => {
    const original = doc('d1', [page('p1'), page('p2')])

    expect(movePageInDocument(original, -1, 0).pages.map((p) => p.id)).toEqual(['p1', 'p2'])
    expect(movePageInDocument(original, 0, 5).pages.map((p) => p.id)).toEqual(['p1', 'p2'])
    expect(movePageInDocument(original, 0, 0).pages.map((p) => p.id)).toEqual(['p1', 'p2'])
  })

  it('keeps each moved page’s flat/enhanced results attached', () => {
    const p1 = page('p1')
    const p2 = { ...page('p2'), flat: { file: 'documents/d/p2.flat.jpg', width: 1, height: 1 } }
    const original = doc('d1', [p1, p2])

    const next = movePageInDocument(original, 1, 0)

    expect(next.pages[0]).toEqual(p2)
    expect(next.pages[1]).toEqual(p1)
  })
})

// --- Invalidation rules (the derivation rule documented in CONTEXT.md) -------
// The whole point of pulling these out: the "what becomes stale" rules get direct,
// focused tests instead of being buried inside the mutation file.

describe('replacePageQuad', () => {
  it('replaces the Quad and drops BOTH flat and enhanced (both derive from it)', () => {
    const original = doc('d1', [
      {
        ...page('p1'),
        flat: { file: 'documents/d/p1.flat.jpg', width: 1, height: 1 },
        enhanced: { file: 'documents/d/p1.enh.jpg', width: 1, height: 1 },
      },
    ])

    const next = replacePageQuad(original, 'p1', OTHER_QUAD)

    expect(next.pages[0].quad).toEqual(OTHER_QUAD)
    expect(next.pages[0].flat).toBeUndefined()
    expect(next.pages[0].enhanced).toBeUndefined()
    // Untouched page is left alone.
    const two = doc('d2', [page('p1'), page('p2')])
    expect(replacePageQuad(two, 'p2', OTHER_QUAD).pages[0]).toEqual(page('p1'))
  })
})

describe('replacePageEnhanceMode', () => {
  it('sets the mode and drops only the enhanced result; the flat is kept', () => {
    const original = doc('d1', [
      {
        ...page('p1'),
        flat: { file: 'documents/d/p1.flat.jpg', width: 1, height: 1 },
        enhanced: { file: 'documents/d/p1.enh.jpg', width: 1, height: 1 },
      },
    ])

    const next = replacePageEnhanceMode(original, 'p1', 'bw' as EnhanceMode)

    expect(next.pages[0].enhanceMode).toBe('bw')
    expect(next.pages[0].enhanced).toBeUndefined()
    expect(next.pages[0].flat).toBeDefined()
  })
})

describe('replacePageFlat / replacePageEnhanced', () => {
  it('attach (or clear) the derived result without touching anything else', () => {
    const original = doc('d1', [page('p1')])
    const flat = { file: 'documents/d/p1.flat.jpg', width: 10, height: 8 }
    const enhanced = { file: 'documents/d/p1.enh.jpg', width: 10, height: 8 }

    const withFlat = replacePageFlat(original, 'p1', flat)
    expect(withFlat.pages[0].flat).toEqual(flat)

    const withEnhanced = replacePageEnhanced(withFlat, 'p1', enhanced)
    expect(withEnhanced.pages[0].enhanced).toEqual(enhanced)
    expect(withEnhanced.pages[0].flat).toEqual(flat)

    const cleared = replacePageFlat(withEnhanced, 'p1', undefined)
    expect(cleared.pages[0].flat).toBeUndefined()
    expect(cleared.pages[0].enhanced).toEqual(enhanced)
  })
})
