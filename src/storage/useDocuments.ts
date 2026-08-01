import { useSyncExternalStore } from 'react'
import type { Bytes, Document, DocumentSummary } from '../types'
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

/**
 * Dev-only helper that creates a Document with a single page from the given
 * JPEG bytes. Proves the full OPFS round-trip (image write + library write +
 * reactive list) before the real capture flow exists (M1/M5). Remove later.
 */
export async function createDemoDocument(
  title: string,
  imageBytes: Bytes,
  width: number,
  height: number,
): Promise<void> {
  const docId = crypto.randomUUID()
  const pageId = crypto.randomUUID()
  const file = await storage.putPageImage(docId, pageId, imageBytes)
  const doc: Document = {
    id: docId,
    title,
    createdAt: Date.now(),
    pages: [
      {
        id: pageId,
        file,
        // Placeholder quad = full-image corners (real detection arrives at M2/M3).
        quad: [
          { x: 0, y: 0 },
          { x: width, y: 0 },
          { x: width, y: height },
          { x: 0, y: height },
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
