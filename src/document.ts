// Pure Document/Page transforms — the editing and invalidation rules (ADR: the
// "Document store" deepening). No I/O, no React: plain functions that take a
// Document and return a new one (immutable, FP style). The impure reactive shell
// (`storage/document-store.ts`) calls these and persists the result.
//
// The invalidation rules live here and nowhere else:
//   - a Quad change drops BOTH the flat and the enhanced (both are stale)
//   - an enhance-mode change drops only the enhanced (the flat is geometry-only)
//   - setting a new flat/enhanced result just attaches it
// These mirror the derivation rule documented in CONTEXT.md (Enhancement).

import type { Document, EnhancedImage, EnhanceMode, FlatImage, Page, Quad } from './types'

/** Pure: a new Document with the Page appended to the end of its page list. */
export function appendPageToDocument(doc: Document, page: Page): Document {
  return { ...doc, pages: [...doc.pages, page] }
}

/**
 * Pure: a new Document with one Page removed (immutable). No-op (equivalent
 *  Document) when the id is absent. Returns an empty-pages Document if it was
 *  the last page — the persisted `removePage` deletes the whole Document then,
 *  so the library never holds an empty Document.
 */
export function removePageFromDocument(doc: Document, pageId: string): Document {
  return { ...doc, pages: doc.pages.filter((p) => p.id !== pageId) }
}

/** Pure: a new Document with one Page moved from `fromIndex` to `toIndex`
 *  (immutable array move, no in-place mutation). No-op (returns the same
 *  Document) when either index is out of range or they are equal, so move-up at
 *  the top / move-down at the bottom are safe. The page objects are reused by
 *  reference, so each moved page keeps its flat/enhanced results. */
export function movePageInDocument(doc: Document, fromIndex: number, toIndex: number): Document {
  if (fromIndex < 0 || fromIndex >= doc.pages.length) return doc
  if (toIndex < 0 || toIndex >= doc.pages.length) return doc
  if (fromIndex === toIndex) return doc
  const moved = doc.pages[fromIndex]
  const rest = doc.pages.filter((_, i) => i !== fromIndex)
  return { ...doc, pages: [...rest.slice(0, toIndex), moved, ...rest.slice(toIndex)] }
}

/**
 * Pure: a new Document with one Page's boundary Quad replaced (immutable).
 * The page's flattened AND enhanced results are dropped — a changed boundary
 * makes the old flat (and its derived enhanced image) stale, so the Document
 * re-warps and re-enhances on next view. (The orphaned files are left in OPFS;
 * orphan reconciliation is deferred per ADR-0003.)
 */
export function replacePageQuad(doc: Document, pageId: string, quad: Quad): Document {
  return {
    ...doc,
    pages: doc.pages.map((p) =>
      p.id === pageId ? { ...p, quad, flat: undefined, enhanced: undefined } : p,
    ),
  }
}

/**
 * Pure: a new Document with one Page's enhance mode set and its cached enhanced
 * image dropped. The enhanced view is derived from the flat, so a new mode
 * invalidates it; the Document re-enhances off the existing flat on next view.
 * The flat itself is untouched — the mode is independent of the geometry.
 */
export function replacePageEnhanceMode(doc: Document, pageId: string, mode: EnhanceMode): Document {
  return {
    ...doc,
    pages: doc.pages.map((p) => (p.id === pageId ? { ...p, enhanceMode: mode, enhanced: undefined } : p)),
  }
}

/** Pure: a new Document with one Page's flattened result set (or cleared). */
export function replacePageFlat(
  doc: Document,
  pageId: string,
  flat: FlatImage | undefined,
): Document {
  return { ...doc, pages: doc.pages.map((p) => (p.id === pageId ? { ...p, flat } : p)) }
}

/** Pure: a new Document with one Page's enhanced result set (or cleared). */
export function replacePageEnhanced(
  doc: Document,
  pageId: string,
  enhanced: EnhancedImage | undefined,
): Document {
  return { ...doc, pages: doc.pages.map((p) => (p.id === pageId ? { ...p, enhanced } : p)) }
}
