import { useCallback, useSyncExternalStore } from 'react'
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
import {
  appendPageToDocument,
  movePageInDocument,
  removePageFromDocument,
  replacePageEnhanced,
  replacePageEnhanceMode,
  replacePageFlat,
  replacePageQuad,
} from '../document'
import { opfsStorage } from './opfs-storage'
import type { Storage } from './storage-port'

/**
 * The Document store — the deep module behind the storage seam (ADR-0003).
 *
 * One reactive, sole-writer home for the Document graph. It exposes the document
 * list AND the open Document reactively (via `useSyncExternalStore`), and it is
 * the *only* module that reads/writes the document graph through the storage
 * port — so the snapshot a component reads is always the value the store itself
 * just wrote. There is no second copy of the Document held in component state and
 * reconciled by hand: the snapshot is derived, not mirrored.
 *
 * Mutations follow one discipline (persist-first, then set the open-Document
 * cache from the pure transform, then emit — no OPFS re-read): the write lands
 * before the cache moves, so a failed write leaves the cache matching storage.
 *
 * Pure edit/invalidation rules live in `document.ts`; this module is the impure
 * reactive shell over them.
 */

/** Source image for a single-page Document: JPEG bytes + its dimensions. */
export interface SinglePageImage {
  readonly bytes: Bytes
  readonly width: number
  readonly height: number
}

export interface DocumentStore {
  /** Subscribe to the document-list (summaries) snapshot. */
  readonly subscribeDocuments: (cb: () => void) => () => void
  /** The cached document summaries (newest-first). Empty until the first load. */
  readonly getDocuments: () => readonly DocumentSummary[]
  /** Subscribe to the open Document's snapshot. Triggers its (re)load on first bind. */
  readonly subscribeDocument: (docId: string, cb: () => void) => () => void
  /** The cached open Document, or undefined while loading / not the open doc. */
  readonly getDocumentSnapshot: (docId: string) => Document | undefined
  /** Read a Document by id — cache hit when it's the open doc, port read otherwise. */
  readonly getDocument: (docId: string) => Promise<Document | undefined>

  // --- mutations (the sole writers to the document graph) ---
  readonly createDocument: (title: string) => Promise<string>
  readonly appendPage: (docId: string, image: SinglePageImage, quad?: Quad) => Promise<void>
  readonly createSinglePageDocument: (
    title: string,
    image: SinglePageImage,
    quad?: Quad,
  ) => Promise<void>
  readonly removeDocument: (id: string) => Promise<void>
  readonly removePage: (docId: string, pageId: string) => Promise<void>
  readonly movePage: (docId: string, fromIndex: number, toIndex: number) => Promise<void>
  readonly updatePageQuad: (docId: string, pageId: string, quad: Quad) => Promise<void>
  readonly updatePageEnhanceMode: (docId: string, pageId: string, mode: EnhanceMode) => Promise<void>
  readonly setPageFlat: (
    docId: string,
    pageId: string,
    bytes: Bytes,
    width: number,
    height: number,
  ) => Promise<FlatImage>
  readonly setPageEnhanced: (
    docId: string,
    pageId: string,
    bytes: Bytes,
    width: number,
    height: number,
  ) => Promise<EnhancedImage>
}

/** Full-frame boundary (TL, TR, BR, BL) — the placeholder Quad for a fresh page. */
function fullFrameQuad(width: number, height: number): Quad {
  return [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: height },
    { x: 0, y: height },
  ]
}

/**
 * Build a Document store over a storage port. The app wires the real OPFS adapter
 * (`opfsStorage`); tests pass an in-memory fake — the port's second adapter, the
 * seam ADR-0003 set up. State is held in the closure, so each store instance is
 * isolated.
 */
export function createDocumentStore(storage: Storage): DocumentStore {
  // --- list (summaries) cache ---
  let summaries: readonly DocumentSummary[] = []
  let summariesLoaded = false
  let summariesLoading: Promise<void> | null = null
  const summaryListeners = new Set<() => void>()

  // --- open Document cache (single slot — the app is single-screen, one open) ---
  let openId: string | null = null
  let openDoc: Document | undefined = undefined
  let openLoading: Promise<void> | null = null
  const docListeners = new Set<() => void>()

  function emitSummaries(): void {
    for (const listener of summaryListeners) listener()
  }
  function emitDoc(): void {
    for (const listener of docListeners) listener()
  }

  async function refreshSummaries(): Promise<void> {
    summaries = await storage.listDocuments()
    summariesLoaded = true
    emitSummaries()
  }

  function ensureSummaries(): void {
    if (!summariesLoaded && !summariesLoading) {
      summariesLoading = refreshSummaries().finally(() => {
        summariesLoading = null
      })
    }
  }

  // --- open Document load ---
  async function loadDocument(docId: string): Promise<void> {
    // A later switch to another doc invalidates an in-flight load.
    if (openId !== docId) return
    const loaded = await storage.getDocument(docId)
    if (openId !== docId) return
    openDoc = loaded
    emitDoc()
  }

  /** Target the slot at `docId` (swapping if a different doc was open) and load it. */
  function ensureOpen(docId: string): void {
    if (openId !== docId) {
      openId = docId
      openDoc = undefined
    }
    if (openDoc === undefined && !openLoading) {
      openLoading = loadDocument(docId).finally(() => {
        openLoading = null
      })
    }
  }

  /**
   * Reflect a mutation into the open-Document cache. Called only with the Document
   * the store just persisted (sole writer), so the snapshot provably matches
   * storage. `{ deleted: true }` clears the slot (the last page was removed / the
   * Document was deleted). No-op when the mutation touched a doc that isn't open.
   */
  function reflect(docId: string, next: Document | undefined, deleted = false): void {
    if (openId !== docId) return
    if (deleted) {
      openId = null
      openDoc = undefined
    } else {
      openDoc = next
    }
    emitDoc()
  }

  /** Best-effort reclaim of a Page's OPFS files: source always, plus flat/enhanced
   *  when they have materialised. Each delete is swallowed so a missing derived file
   *  (never viewed) can't abort removing the page. */
  async function reclaimPageFiles(page: Page): Promise<void> {
    const paths = [page.file, page.flat?.file, page.enhanced?.file].filter(
      (p): p is string => p != null,
    )
    await Promise.all(paths.map((p) => storage.deletePageFile(p)))
  }

  // --- public surface ---

  function subscribeDocuments(cb: () => void): () => void {
    summaryListeners.add(cb)
    ensureSummaries()
    return () => {
      summaryListeners.delete(cb)
    }
  }

  function getDocuments(): readonly DocumentSummary[] {
    return summaries
  }

  function subscribeDocument(docId: string, cb: () => void): () => void {
    docListeners.add(cb)
    ensureOpen(docId)
    return () => {
      docListeners.delete(cb)
    }
  }

  function getDocumentSnapshot(docId: string): Document | undefined {
    return openId === docId ? openDoc : undefined
  }

  async function getDocument(docId: string): Promise<Document | undefined> {
    if (openId === docId && openDoc !== undefined) return openDoc
    return storage.getDocument(docId)
  }

  // --- mutations ---

  /**
   * Persist a new empty Document (no pages) and return its id. The capture
   * session calls this once, then `appendPage` per captured page. Does not refresh
   * the list nor target the open slot — the batch only becomes visible once its
   * pages are appended, so nothing appears in the library until the session saves.
   */
  async function createDocument(title: string): Promise<string> {
    const docId = crypto.randomUUID()
    const newDoc: Document = { id: docId, title, createdAt: Date.now(), pages: [] }
    await storage.putDocument(newDoc)
    return docId
  }

  /**
   * Write a page's source JPEG via the port and append a Page (full-frame
   * placeholder Quad when none given, `enhanceMode = 'color'`, no flat/enhanced
   * yet), persist the Document, reflect it into the open slot, and refresh the
   * list. Throws if the document is missing.
   */
  async function appendPage(
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
      quad: quad ?? fullFrameQuad(image.width, image.height),
      enhanceMode: 'color',
    }
    const next = appendPageToDocument(doc, page)
    await storage.putDocument(next)
    reflect(docId, next)
    await refreshSummaries()
  }

  /** Persist a single-page Document — a thin `createDocument` + `appendPage`. */
  async function createSinglePageDocument(
    title: string,
    image: SinglePageImage,
    quad?: Quad,
  ): Promise<void> {
    const docId = await createDocument(title)
    await appendPage(docId, image, quad)
  }

  async function removeDocument(id: string): Promise<void> {
    await storage.deleteDocument(id)
    reflect(id, undefined, true)
    await refreshSummaries()
  }

  /**
   * Remove a single Page: reclaim its source/flat/enhanced OPFS files (the page is
   * gone entirely — unlike a Quad-edit, which leaves orphaned derived files), drop
   * it from the array, persist, reflect, and refresh. If it was the last Page, the
   * whole Document is deleted instead so the library holds no empty Documents.
   * No-op if the Document or Page is missing.
   */
  async function removePage(docId: string, pageId: string): Promise<void> {
    const doc = await storage.getDocument(docId)
    if (!doc) return
    const page = doc.pages.find((p) => p.id === pageId)
    if (!page) return
    await reclaimPageFiles(page)
    const next = removePageFromDocument(doc, pageId)
    if (next.pages.length === 0) {
      await storage.deleteDocument(docId)
      reflect(docId, undefined, true)
    } else {
      await storage.putDocument(next)
      reflect(docId, next)
    }
    await refreshSummaries()
  }

  /**
   * Reorder one Page within a Document: an immutable array move, then persist and
   * reflect. Out-of-range indices are a no-op. The persisted order is the source of
   * truth a later export consumes — not a view-only sort. No-op if the Document is
   * missing.
   */
  async function movePage(docId: string, fromIndex: number, toIndex: number): Promise<void> {
    const doc = await storage.getDocument(docId)
    if (!doc) return
    const next = movePageInDocument(doc, fromIndex, toIndex)
    await storage.putDocument(next)
    reflect(docId, next)
    await refreshSummaries()
  }

  /**
   * Replace a single Page's boundary Quad (immutably — also dropping its now-stale
   * flat and enhanced) and persist. The source photo is untouched — only the
   * adjusted Quad is saved. No-op if the document is missing.
   */
  async function updatePageQuad(docId: string, pageId: string, quad: Quad): Promise<void> {
    const doc = await storage.getDocument(docId)
    if (!doc) return
    const next = replacePageQuad(doc, pageId, quad)
    await storage.putDocument(next)
    reflect(docId, next)
    await refreshSummaries()
  }

  /**
   * Persist a Page's `enhanceMode` and drop its now-stale enhanced image, so the
   * Document re-enhances off the existing flat with the new look on next view.
   * Mirrors `updatePageQuad` (a persisted field change that invalidates a derived
   * result) but leaves the flat in place. No-op if the document is missing.
   */
  async function updatePageEnhanceMode(
    docId: string,
    pageId: string,
    mode: EnhanceMode,
  ): Promise<void> {
    const doc = await storage.getDocument(docId)
    if (!doc) return
    const next = replacePageEnhanceMode(doc, pageId, mode)
    await storage.putDocument(next)
    reflect(docId, next)
    await refreshSummaries()
  }

  /**
   * Write a Page's flattened JPEG, attach the FlatImage, persist, reflect into the
   * open slot, and return the FlatImage. The single mutation the UI calls after a
   * warp — it keeps the OPFS write behind the store so the view doesn't reach into
   * the port directly. Does not refresh the list (the flat doesn't change the
   * summary). Throws if the document is missing.
   */
  async function setPageFlat(
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
    const next = replacePageFlat(doc, pageId, flat)
    await storage.putDocument(next)
    reflect(docId, next)
    return flat
  }

  /**
   * Write a Page's enhanced JPEG, attach the EnhancedImage, persist, reflect into
   * the open slot, and return the EnhancedImage. Mirrors `setPageFlat`: the single
   * mutation the UI calls after an enhance. Does not refresh the list. Throws if
   * the document is missing.
   */
  async function setPageEnhanced(
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
    const next = replacePageEnhanced(doc, pageId, enhanced)
    await storage.putDocument(next)
    reflect(docId, next)
    return enhanced
  }

  return {
    subscribeDocuments,
    getDocuments,
    subscribeDocument,
    getDocumentSnapshot,
    getDocument,
    createDocument,
    appendPage,
    createSinglePageDocument,
    removeDocument,
    removePage,
    movePage,
    updatePageQuad,
    updatePageEnhanceMode,
    setPageFlat,
    setPageEnhanced,
  }
}

/** The app's store — over the real OPFS adapter. */
export const documentStore: DocumentStore = createDocumentStore(opfsStorage)

// --- React bindings ---------------------------------------------------------

/** Reactive view of the document library (summaries). */
export function useDocuments(): readonly DocumentSummary[] {
  return useSyncExternalStore(
    documentStore.subscribeDocuments,
    documentStore.getDocuments,
    documentStore.getDocuments,
  )
}

/**
 * Reactive view of one open Document. Loads on first bind; the snapshot is always
 * the value the store itself last wrote (mutations flow through the store), so a
 * component never holds its own copy. Returns undefined until the first load
 * resolves (or when the Document is missing).
 */
export function useDocument(docId: string): Document | undefined {
  // Re-bind only when the id changes, not every render.
  const subscribe = useCallback(
    (cb: () => void) => documentStore.subscribeDocument(docId, cb),
    [docId],
  )
  const getSnapshot = useCallback(() => documentStore.getDocumentSnapshot(docId), [docId])
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
