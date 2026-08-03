import type { Bytes, Document, DocumentSummary } from '../types'

/**
 * Storage port — the seam between the app and persistence (ADR-0003).
 *
 * The only implementation today is OPFS-only (`opfs-storage`). If a future
 * version needs real queries (e.g. full-text search over OCR text), we
 * implement this same type over IndexedDB or SQLite-WASM without touching
 * the rest of the app.
 */
export type Storage = {
  /** All documents, newest-first, without page bodies. */
  readonly listDocuments: () => Promise<readonly DocumentSummary[]>
  /** Full document by id, or undefined if missing. */
  readonly getDocument: (id: string) => Promise<Document | undefined>
  /** Insert or replace a document (matched by id). */
  readonly putDocument: (doc: Document) => Promise<void>
  /** Remove a document and its page images. */
  readonly deleteDocument: (id: string) => Promise<void>
  /** Persist a page's source JPEG bytes; returns its OPFS path. */
  readonly putPageImage: (docId: string, pageId: string, bytes: Bytes) => Promise<string>
  /** Persist a page's flattened JPEG bytes; returns its OPFS path. */
  readonly putPageFlat: (docId: string, pageId: string, bytes: Bytes) => Promise<string>
  /** Persist a page's enhanced JPEG bytes; returns its OPFS path. */
  readonly putPageEnhanced: (docId: string, pageId: string, bytes: Bytes) => Promise<string>
  /** Read a page image as a Blob by path, or undefined if missing. */
  readonly getPageImage: (path: string) => Promise<Blob | undefined>
}
