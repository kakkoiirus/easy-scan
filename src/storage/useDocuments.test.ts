import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Bytes, Document, Page, Quad } from '../types'
import type { Storage } from './storage-port'

// --- In-memory fake of the Storage port -------------------------------------
// The transforms under test orchestrate real I/O (write JPEG, read/put the
// document, refresh). Per the spec's testing decisions we drive them against an
// in-memory fake rather than real OPFS. `vi.hoisted` keeps the fake reachable
// inside the hoisted `vi.mock` factory.
const { storage, state } = vi.hoisted(() => {
  const state: { docs: Map<string, Document>; files: Map<string, Bytes> } = {
    docs: new Map(),
    files: new Map(),
  }
  const storage: Storage = {
    listDocuments: () =>
      Promise.resolve(
        [...state.docs.values()]
          .map((d) => ({
            id: d.id,
            title: d.title,
            createdAt: d.createdAt,
            pageCount: d.pages.length,
          }))
          .sort((a, b) => b.createdAt - a.createdAt),
      ),
    getDocument: (id: string) => Promise.resolve(state.docs.get(id)),
    putDocument: (doc: Document) => {
      state.docs.set(doc.id, doc)
      return Promise.resolve()
    },
    deleteDocument: (id: string) => {
      state.docs.delete(id)
      return Promise.resolve()
    },
    putPageImage: (docId: string, pageId: string, bytes: Bytes) => {
      const p = `documents/${docId}/${pageId}.jpg`
      state.files.set(p, bytes)
      return Promise.resolve(p)
    },
    putPageFlat: (docId: string, pageId: string, bytes: Bytes) => {
      const p = `documents/${docId}/${pageId}.flat.jpg`
      state.files.set(p, bytes)
      return Promise.resolve(p)
    },
    putPageEnhanced: (docId: string, pageId: string, bytes: Bytes) => {
      const p = `documents/${docId}/${pageId}.enh.jpg`
      state.files.set(p, bytes)
      return Promise.resolve(p)
    },
    getPageImage: (path: string) => {
      const b = state.files.get(path)
      return Promise.resolve(b ? new Blob([b]) : undefined)
    },
  }
  return { storage, state }
})

vi.mock('./opfs-storage', () => ({ opfsStorage: storage }))

// vitest hoists `vi.mock` above this static import, so `useDocuments` loads with
// the fake storage wired in.
import {
  appendPageToDocument,
  appendPage,
  createDocument,
  createSinglePageDocument,
  setPageFlat,
  setPageEnhanced,
} from './useDocuments'

// --- Fixtures ----------------------------------------------------------------

const QUAD: Quad = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 8 },
  { x: 0, y: 8 },
]

function page(id: string): Page {
  return { id, file: `documents/d/${id}.jpg`, quad: QUAD, enhanceMode: 'color' }
}

function doc(id: string, pages: readonly Page[]): Document {
  return { id, title: id, createdAt: 1, pages }
}

const IMAGE = { bytes: new Uint8Array([1, 2, 3, 4]), width: 10, height: 8 }

const FLAT_BYTES = new Uint8Array([10, 20, 30])
const ENH_BYTES = new Uint8Array([40, 50, 60])

beforeEach(() => {
  state.docs.clear()
  state.files.clear()
})

// --- Pure transform ----------------------------------------------------------

describe('appendPageToDocument', () => {
  it('appends the page to the end without mutating the source document', () => {
    const original = doc('d1', [page('p1'), page('p2')])

    const next = appendPageToDocument(original, page('p3'))

    expect(next.pages.map((p) => p.id)).toEqual(['p1', 'p2', 'p3'])
    expect(original.pages.map((p) => p.id)).toEqual(['p1', 'p2'])
  })
})

// --- Persisted creation ------------------------------------------------------

describe('createDocument', () => {
  it('persists a new empty document and returns its id', async () => {
    const id = await createDocument('Contract')

    const persisted = await storage.getDocument(id)
    expect(persisted).toBeDefined()
    expect(persisted?.title).toBe('Contract')
    expect(persisted?.pages).toEqual([])
  })
})

describe('appendPage', () => {
  it('writes the source JPEG and appends a color page with the given quad', async () => {
    const docId = await createDocument('Contract')

    await appendPage(docId, IMAGE, QUAD)

    const persisted = await storage.getDocument(docId)
    expect(persisted?.pages).toHaveLength(1)
    const appended = persisted?.pages[0]
    expect(appended?.quad).toEqual(QUAD)
    expect(appended?.enhanceMode).toBe('color')
    expect(appended?.flat).toBeUndefined()
    expect(appended?.enhanced).toBeUndefined()
    // The source JPEG was written under the page's own file path.
    expect(state.files.get(appended!.file)).toEqual(IMAGE.bytes)
  })

  it('defaults to a full-frame quad when none is given', async () => {
    const docId = await createDocument('Contract')

    await appendPage(docId, IMAGE)

    const appended = (await storage.getDocument(docId))?.pages[0]
    expect(appended?.quad).toEqual([
      { x: 0, y: 0 },
      { x: IMAGE.width, y: 0 },
      { x: IMAGE.width, y: IMAGE.height },
      { x: 0, y: IMAGE.height },
    ])
  })

  it('appends further pages after existing ones, in capture order', async () => {
    const docId = await createDocument('Contract')

    await appendPage(docId, { ...IMAGE, bytes: new Uint8Array([1]) })
    await appendPage(docId, { ...IMAGE, bytes: new Uint8Array([2]) })
    await appendPage(docId, { ...IMAGE, bytes: new Uint8Array([3]) })

    const persisted = await storage.getDocument(docId)
    expect(persisted?.pages).toHaveLength(3)
    // Each page keeps its own source JPEG, in the order it was captured.
    const filesInOrder = persisted!.pages.map((p) => state.files.get(p.file))
    expect(filesInOrder).toEqual([
      new Uint8Array([1]),
      new Uint8Array([2]),
      new Uint8Array([3]),
    ])
  })
})

// --- Single-capture path (decomposed into createDocument + appendPage) --------

describe('createSinglePageDocument', () => {
  it('creates a one-page document carrying the given quad', async () => {
    await createSinglePageDocument('Single', IMAGE, QUAD)

    const docs = await storage.listDocuments()
    expect(docs).toHaveLength(1)
    expect(docs[0].pageCount).toBe(1)

    const doc = await storage.getDocument(docs[0].id)
    expect(doc?.pages[0].quad).toEqual(QUAD)
    expect(doc?.pages[0].enhanceMode).toBe('color')
  })

  it('defaults to a full-frame quad when none is given', async () => {
    await createSinglePageDocument('Single', IMAGE)

    const [summary] = await storage.listDocuments()
    const doc = await storage.getDocument(summary.id)
    expect(doc?.pages[0].quad).toEqual([
      { x: 0, y: 0 },
      { x: IMAGE.width, y: 0 },
      { x: IMAGE.width, y: IMAGE.height },
      { x: 0, y: IMAGE.height },
    ])
  })
})

// --- Add page to an existing Document (ticket 03) ----------------------------
// The "add page to an existing Document" flow reuses `appendPage` against a
// Document that already holds pages. The guarantee that matters: appending never
// rewrites a sibling, so a page that already has its flat/enhanced results keeps
// them, and no new Document is born. This is what lets the user extend a saved
// Document without risking the pages already in it.

describe('appendPage to an existing Document', () => {
  it('leaves earlier pages (flat/enhanced included) byte-for-byte untouched', async () => {
    const docId = await createDocument('Contract')
    await appendPage(docId, IMAGE, QUAD)
    const firstPage = (await storage.getDocument(docId))!.pages[0]
    // Materialise the first page fully (flat + enhanced), as if the user had
    // already viewed it. Appending a new page must not disturb any of this.
    await setPageFlat(docId, firstPage.id, FLAT_BYTES, 10, 8)
    await setPageEnhanced(docId, firstPage.id, ENH_BYTES, 10, 8)
    const processed = (await storage.getDocument(docId))!.pages[0]
    expect(processed.flat).toBeDefined()
    expect(processed.enhanced).toBeDefined()

    await appendPage(docId, { ...IMAGE, bytes: new Uint8Array([9]) }, QUAD)

    const after = await storage.getDocument(docId)
    expect(after?.pages).toHaveLength(2)
    // The earlier page is unchanged — same id, quad, flat, enhanced, mode.
    expect(after!.pages[0]).toEqual(processed)
    // The appended page is a fresh color page with no flat/enhanced yet.
    const added = after!.pages[1]
    expect(added.id).not.toBe(firstPage.id)
    expect(added.enhanceMode).toBe('color')
    expect(added.flat).toBeUndefined()
    expect(added.enhanced).toBeUndefined()
  })

  it('does not create a new Document — same id, still one item in the library', async () => {
    const docId = await createDocument('Contract')
    await appendPage(docId, IMAGE, QUAD)

    // The add-page flow appends into the same Document across several captures.
    await appendPage(docId, IMAGE, QUAD)
    await appendPage(docId, IMAGE, QUAD)

    const docs = await storage.listDocuments()
    expect(docs).toHaveLength(1)
    expect(docs[0].id).toBe(docId)
    expect(docs[0].pageCount).toBe(3)
  })

  it('preserves the existing Document title and createdAt', async () => {
    const docId = await createDocument('Lease 2024')
    await appendPage(docId, IMAGE, QUAD)
    const before = (await storage.getDocument(docId))!

    await appendPage(docId, IMAGE, QUAD)

    const after = await storage.getDocument(docId)
    expect(after?.title).toBe(before.title)
    expect(after?.createdAt).toBe(before.createdAt)
  })
})
