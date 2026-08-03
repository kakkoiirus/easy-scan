import { useSyncExternalStore } from 'react'
import type { Bytes, Document, DocumentSummary, Quad } from '../types'
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

/**
 * Persist a single-page Document: writes the JPEG via `putPageImage`, then a
 * Document with one Page carrying the given boundary Quad (defaulting to the
 * full-frame placeholder) and `enhanceMode = 'color'`, then refreshes the
 * reactive list. Shared by the real capture path (detected quad) and the dev
 * demo button (full-frame default).
 */
export async function createSinglePageDocument(
  title: string,
  image: SinglePageImage,
  quad?: Quad,
): Promise<void> {
  const docId = crypto.randomUUID()
  const pageId = crypto.randomUUID()
  const file = await storage.putPageImage(docId, pageId, image.bytes)
  const doc: Document = {
    id: docId,
    title,
    createdAt: Date.now(),
    pages: [
      {
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
      },
    ],
  }
  await storage.putDocument(doc)
  await refresh()
}

export async function removeDocument(id: string): Promise<void> {
  await storage.deleteDocument(id)
  await refresh()
}

/** Pure: a new Document with one Page's boundary Quad replaced (immutable). */
export function replacePageQuad(doc: Document, pageId: string, quad: Quad): Document {
  return { ...doc, pages: doc.pages.map((p) => (p.id === pageId ? { ...p, quad } : p)) }
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
