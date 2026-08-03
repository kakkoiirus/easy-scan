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
