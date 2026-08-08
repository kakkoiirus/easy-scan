import { useSyncExternalStore } from 'react'
import type {
  Bytes,
  Document,
  DocumentSummary,
  EnhancedImage,
  EnhanceMode,
  FlatImage,
  Page,
  Quad,
} from '../types'
import { opfsStorage as storage } from './opfs-storage'

/**
 * Reactive view over the storage port, backed by `useSyncExternalStore`.
 * The store is the single impure boundary here: it caches the document list
 * in memory, persists through `storage`, and notifies React on change.
 */

let cache: readonly DocumentSummary[] = []
let loaded = false
let loading: Promise<void> | null = null
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

async function refresh(): Promise<void> {
  cache = await storage.listDocuments()
  loaded = true
  emit()
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  if (!loaded && !loading) {
    loading = refresh().finally(() => {
      loading = null
    })
  }
  return () => {
    listeners.delete(cb)
  }
}

function getSnapshot(): readonly DocumentSummary[] {
  return cache
}

export function useDocuments(): readonly DocumentSummary[] {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

// --- Mutations -------------------------------------------------------------

/** Source image for a single-page Document: JPEG bytes + its dimensions. */
export interface SinglePageImage {
  readonly bytes: Bytes
  readonly width: number
  readonly height: number
}

/** Pure: a new Document with the page appended to the end of its page list. */
export function appendPageToDocument(doc: Document, page: Page): Document {
  return { ...doc, pages: [...doc.pages, page] }
}

/** Pure: a new Document with one Page removed (immutable). No-op (equivalent
 *  Document) when the id is absent. Returns an empty-pages Document if it was
 *  the last page — the persisted `removePage` deletes the whole Document then,
 *  so the library never holds an empty Document. */
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
 * Persist a new empty Document (no pages) and return its id. The capture
 * session calls this once, then `appendPage` per captured page at "Готово".
 * Does not refresh the reactive list — the batch only becomes visible once its
 * pages are appended, so nothing appears in the library until the session is
 * saved.
 */
export async function createDocument(title: string): Promise<string> {
  const docId = crypto.randomUUID()
  const doc: Document = { id: docId, title, createdAt: Date.now(), pages: [] }
  await storage.putDocument(doc)
  return docId
}

/**
 * Write a page's source JPEG via the storage port and append a Page (full-frame
 * placeholder Quad when none given, `enhanceMode = 'color'`, no flat/enhanced
 * yet), persist the Document, and refresh the reactive list. The persisted
 * counterpart of `appendPageToDocument`; the capture session calls this once per
 * captured page. Throws if the document is missing.
 */
export async function appendPage(
  docId: string,
  image: SinglePageImage,
  quad?: Quad,
): Promise<void> {
  const doc = await storage.getDocument(docId)
  if (!doc) throw new Error(`document ${docId} not found`)
  const pageId = crypto.randomUUID()
  const file = await storage.putPageImage(docId, pageId, image.bytes)
  const page: Page = {
    id: pageId,
    file,
    quad:
      quad ?? [
        { x: 0, y: 0 },
        { x: image.width, y: 0 },
        { x: image.width, y: image.height },
        { x: 0, y: image.height },
      ],
    enhanceMode: 'color',
  }
  await storage.putDocument(appendPageToDocument(doc, page))
  await refresh()
}

/**
 * Persist a single-page Document — a thin `createDocument` + `appendPage`. The
 * single-capture path (one page then "Готово") and the dev demo button both
 * reuse the same creation path as a multi-page session; they just stop after one
 * page.
 */
export async function createSinglePageDocument(
  title: string,
  image: SinglePageImage,
  quad?: Quad,
): Promise<void> {
  const docId = await createDocument(title)
  await appendPage(docId, image, quad)
}

export async function removeDocument(id: string): Promise<void> {
  await storage.deleteDocument(id)
  await refresh()
}

/** Best-effort reclaim of a Page's OPFS files: its source JPEG always, plus the
 *  flat/enhanced JPEGs when they have materialised. Each delete is swallowed so a
 *  missing derived file (never viewed) can't abort removing the page — mirroring
 *  `deleteDocument`'s folder-removal. */
async function reclaimPageFiles(page: Page): Promise<void> {
  const paths = [page.file, page.flat?.file, page.enhanced?.file].filter(
    (p): p is string => p != null,
  )
  await Promise.all(paths.map((p) => storage.deletePageFile(p)))
}

/**
 * Remove a single Page: reclaim its source/flat/enhanced OPFS files (the page is
 * gone entirely — unlike a `Quad`-edit, which leaves orphaned derived files), drop
 * it from the array, persist, and refresh. If it was the last Page, the whole
 * Document is deleted instead so the library holds no empty Documents — mirroring
 * `deleteDocument`'s reclaim. No-op if the Document or Page is missing.
 */
export async function removePage(docId: string, pageId: string): Promise<void> {
  const doc = await storage.getDocument(docId)
  if (!doc) return
  const page = doc.pages.find((p) => p.id === pageId)
  if (!page) return
  await reclaimPageFiles(page)
  const next = removePageFromDocument(doc, pageId)
  if (next.pages.length === 0) {
    await storage.deleteDocument(docId)
  } else {
    await storage.putDocument(next)
  }
  await refresh()
}

/**
 * Reorder one Page within a Document: an immutable array move (`movePageInDocument`)
 * then persist and refresh. Out-of-range indices are a no-op. The persisted order
 * is the source of truth a later export consumes — not a view-only sort — so it
 * survives reopening the Document. No-op if the Document is missing.
 */
export async function movePage(docId: string, fromIndex: number, toIndex: number): Promise<void> {
  const doc = await storage.getDocument(docId)
  if (!doc) return
  await storage.putDocument(movePageInDocument(doc, fromIndex, toIndex))
  await refresh()
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
 * Replace a single Page's boundary Quad (immutably) and persist the Document.
 * The source photo is untouched — only the adjusted Quad is saved, so later
 * flattening uses the corrected corners without rescanning. No-op if the
 * document is missing.
 */
export async function updatePageQuad(docId: string, pageId: string, quad: Quad): Promise<void> {
  const doc = await storage.getDocument(docId)
  if (!doc) return
  await storage.putDocument(replacePageQuad(doc, pageId, quad))
  await refresh()
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

/**
 * Persist a Page's `enhanceMode` and drop its now-stale enhanced image, so the
 * Document re-enhances off the existing flat with the new look on next view.
 * Mirrors `updatePageQuad` (a persisted field change that invalidates a derived
 * result) but leaves the flat in place. Refreshes the list for consistency with
 * `updatePageQuad`; the mode itself doesn't change the summary.
 */
export async function updatePageEnhanceMode(
  docId: string,
  pageId: string,
  mode: EnhanceMode,
): Promise<void> {
  const doc = await storage.getDocument(docId)
  if (!doc) return
  await storage.putDocument(replacePageEnhanceMode(doc, pageId, mode))
  await refresh()
}

/** Pure: a new Document with one Page's flattened result set (or cleared). */
export function replacePageFlat(
  doc: Document,
  pageId: string,
  flat: FlatImage | undefined,
): Document {
  return { ...doc, pages: doc.pages.map((p) => (p.id === pageId ? { ...p, flat } : p)) }
}

/**
 * Write a Page's flattened JPEG (`putPageFlat`), attach the FlatImage to the
 * Page, persist the Document, and return the FlatImage. The single mutation the
 * UI calls after a warp — it keeps the OPFS write behind the storage port so the
 * view doesn't reach into `opfsStorage` directly. Does not refresh the list (the
 * flat doesn't change the summary; the caller holds the Document locally).
 * Throws if the document is missing.
 */
export async function setPageFlat(
  docId: string,
  pageId: string,
  bytes: Bytes,
  width: number,
  height: number,
): Promise<FlatImage> {
  const doc = await storage.getDocument(docId)
  if (!doc) throw new Error(`document ${docId} not found`)
  const file = await storage.putPageFlat(docId, pageId, bytes)
  const flat: FlatImage = { file, width, height }
  await storage.putDocument(replacePageFlat(doc, pageId, flat))
  return flat
}

/** Pure: a new Document with one Page's enhanced result set (or cleared). */
export function replacePageEnhanced(
  doc: Document,
  pageId: string,
  enhanced: EnhancedImage | undefined,
): Document {
  return { ...doc, pages: doc.pages.map((p) => (p.id === pageId ? { ...p, enhanced } : p)) }
}

/**
 * Write a Page's enhanced JPEG (`putPageEnhanced`), attach the EnhancedImage to
 * the Page, persist the Document, and return the EnhancedImage. Mirrors
 * `setPageFlat`: the single mutation the UI calls after an enhance. Does not
 * refresh the list (the enhanced image doesn't change the summary; the caller
 * holds the Document locally). Throws if the document is missing.
 */
export async function setPageEnhanced(
  docId: string,
  pageId: string,
  bytes: Bytes,
  width: number,
  height: number,
): Promise<EnhancedImage> {
  const doc = await storage.getDocument(docId)
  if (!doc) throw new Error(`document ${docId} not found`)
  const file = await storage.putPageEnhanced(docId, pageId, bytes)
  const enhanced: EnhancedImage = { file, width, height }
  await storage.putDocument(replacePageEnhanced(doc, pageId, enhanced))
  return enhanced
}
