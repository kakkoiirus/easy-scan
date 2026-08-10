import { describe, expect, it } from 'vitest'
import type { Bytes, Document, Quad } from '../types'
import type { Storage } from './storage-port'
import { createDocumentStore, type DocumentStore } from './document-store'

// --- In-memory fake of the Storage port -------------------------------------
// The store's second adapter (the first being `opfsStorage`) — the seam ADR-0003
// set up. Passing it straight into `createDocumentStore` (no `vi.mock`): the store
// is tested through its own interface, against a real fake.

interface FakeState {
  readonly docs: Map<string, Document>
  readonly files: Map<string, Bytes>
}

function fakeStorage(): { readonly storage: Storage; readonly state: FakeState } {
  const docs = new Map<string, Document>()
  const files = new Map<string, Bytes>()
  const storage: Storage = {
    listDocuments: () =>
      Promise.resolve(
        [...docs.values()]
          .map((d) => ({
            id: d.id,
            title: d.title,
            createdAt: d.createdAt,
            pageCount: d.pages.length,
          }))
          .sort((a, b) => b.createdAt - a.createdAt),
      ),
    getDocument: (id: string) => Promise.resolve(docs.get(id)),
    putDocument: (doc: Document) => {
      docs.set(doc.id, doc)
      return Promise.resolve()
    },
    deleteDocument: (id: string) => {
      docs.delete(id)
      return Promise.resolve()
    },
    putPageImage: (docId: string, pageId: string, bytes: Bytes) => {
      const p = `documents/${docId}/${pageId}.jpg`
      files.set(p, bytes)
      return Promise.resolve(p)
    },
    putPageFlat: (docId: string, pageId: string, bytes: Bytes) => {
      const p = `documents/${docId}/${pageId}.flat.jpg`
      files.set(p, bytes)
      return Promise.resolve(p)
    },
    putPageEnhanced: (docId: string, pageId: string, bytes: Bytes) => {
      const p = `documents/${docId}/${pageId}.enh.jpg`
      files.set(p, bytes)
      return Promise.resolve(p)
    },
    getPageImage: (path: string) => {
      const b = files.get(path)
      return Promise.resolve(b ? new Blob([b]) : undefined)
    },
    deletePageFile: (path: string) => {
      files.delete(path)
      return Promise.resolve()
    },
  }
  return { storage, state: { docs, files } }
}

function setup(): { readonly store: DocumentStore; readonly state: FakeState } {
  const { storage, state } = fakeStorage()
  return { store: createDocumentStore(storage), state }
}

/** Let the store's async loads settle (the fake resolves on the microtask queue). */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

// --- Fixtures ----------------------------------------------------------------

const QUAD: Quad = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 8 },
  { x: 0, y: 8 },
]

const IMAGE = { bytes: new Uint8Array([1, 2, 3, 4]), width: 10, height: 8 }
const FLAT_BYTES = new Uint8Array([10, 20, 30])
const ENH_BYTES = new Uint8Array([40, 50, 60])

// --- Persisted creation ------------------------------------------------------

describe('createDocument', () => {
  it('persists a new empty document and returns its id', async () => {
    const { store } = setup()

    const id = await store.createDocument('Contract')

    const persisted = await store.getDocument(id)
    expect(persisted).toBeDefined()
    expect(persisted?.title).toBe('Contract')
    expect(persisted?.pages).toEqual([])
  })
})

describe('appendPage', () => {
  it('writes the source JPEG and appends a color page with the given quad', async () => {
    const { store, state } = setup()
    const docId = await store.createDocument('Contract')

    await store.appendPage(docId, IMAGE, QUAD)

    const persisted = await store.getDocument(docId)
    expect(persisted?.pages).toHaveLength(1)
    const appended = persisted?.pages[0]
    expect(appended?.quad).toEqual(QUAD)
    expect(appended?.enhanceMode).toBe('color')
    expect(appended?.flat).toBeUndefined()
    expect(appended?.enhanced).toBeUndefined()
    expect(state.files.get(appended!.file)).toEqual(IMAGE.bytes)
  })

  it('defaults to a full-frame quad when none is given', async () => {
    const { store } = setup()
    const docId = await store.createDocument('Contract')

    await store.appendPage(docId, IMAGE)

    const appended = (await store.getDocument(docId))?.pages[0]
    expect(appended?.quad).toEqual([
      { x: 0, y: 0 },
      { x: IMAGE.width, y: 0 },
      { x: IMAGE.width, y: IMAGE.height },
      { x: 0, y: IMAGE.height },
    ])
  })

  it('appends further pages after existing ones, in capture order', async () => {
    const { store, state } = setup()
    const docId = await store.createDocument('Contract')

    await store.appendPage(docId, { ...IMAGE, bytes: new Uint8Array([1]) })
    await store.appendPage(docId, { ...IMAGE, bytes: new Uint8Array([2]) })
    await store.appendPage(docId, { ...IMAGE, bytes: new Uint8Array([3]) })

    const persisted = await store.getDocument(docId)
    expect(persisted?.pages).toHaveLength(3)
    const filesInOrder = persisted!.pages.map((p) => state.files.get(p.file))
    expect(filesInOrder).toEqual([
      new Uint8Array([1]),
      new Uint8Array([2]),
      new Uint8Array([3]),
    ])
  })
})

// --- Single-capture path -----------------------------------------------------

describe('createSinglePageDocument', () => {
  it('creates a one-page document carrying the given quad', async () => {
    const { store } = setup()

    await store.createSinglePageDocument('Single', IMAGE, QUAD)

    const docs = store.getDocuments()
    expect(docs).toHaveLength(1)
    expect(docs[0].pageCount).toBe(1)

    const persisted = await store.getDocument(docs[0].id)
    expect(persisted?.pages[0].quad).toEqual(QUAD)
    expect(persisted?.pages[0].enhanceMode).toBe('color')
  })

  it('defaults to a full-frame quad when none is given', async () => {
    const { store } = setup()

    await store.createSinglePageDocument('Single', IMAGE)

    const [summary] = store.getDocuments()
    const persisted = await store.getDocument(summary.id)
    expect(persisted?.pages[0].quad).toEqual([
      { x: 0, y: 0 },
      { x: IMAGE.width, y: 0 },
      { x: IMAGE.width, y: IMAGE.height },
      { x: 0, y: IMAGE.height },
    ])
  })
})

// --- Add page to an existing Document ----------------------------------------

describe('appendPage to an existing Document', () => {
  it('leaves earlier pages (flat/enhanced included) byte-for-byte untouched', async () => {
    const { store } = setup()
    const docId = await store.createDocument('Contract')
    await store.appendPage(docId, IMAGE, QUAD)
    const firstPage = (await store.getDocument(docId))!.pages[0]
    await store.setPageFlat(docId, firstPage.id, FLAT_BYTES, 10, 8)
    await store.setPageEnhanced(docId, firstPage.id, ENH_BYTES, 10, 8)
    const processed = (await store.getDocument(docId))!.pages[0]
    expect(processed.flat).toBeDefined()
    expect(processed.enhanced).toBeDefined()

    await store.appendPage(docId, { ...IMAGE, bytes: new Uint8Array([9]) }, QUAD)

    const after = await store.getDocument(docId)
    expect(after?.pages).toHaveLength(2)
    expect(after!.pages[0]).toEqual(processed)
    const added = after!.pages[1]
    expect(added.id).not.toBe(firstPage.id)
    expect(added.enhanceMode).toBe('color')
    expect(added.flat).toBeUndefined()
    expect(added.enhanced).toBeUndefined()
  })

  it('does not create a new Document — same id, still one item in the library', async () => {
    const { store } = setup()
    const docId = await store.createDocument('Contract')
    await store.appendPage(docId, IMAGE, QUAD)
    await store.appendPage(docId, IMAGE, QUAD)
    await store.appendPage(docId, IMAGE, QUAD)

    const docs = store.getDocuments()
    expect(docs).toHaveLength(1)
    expect(docs[0].id).toBe(docId)
    expect(docs[0].pageCount).toBe(3)
  })

  it('preserves the existing Document title and createdAt', async () => {
    const { store } = setup()
    const docId = await store.createDocument('Lease 2024')
    await store.appendPage(docId, IMAGE, QUAD)
    const before = (await store.getDocument(docId))!

    await store.appendPage(docId, IMAGE, QUAD)

    const after = await store.getDocument(docId)
    expect(after?.title).toBe(before.title)
    expect(after?.createdAt).toBe(before.createdAt)
  })
})

// --- Remove a page -----------------------------------------------------------

describe('removePage', () => {
  it('reclaims the removed page’s source/flat/enhanced files but not its siblings’', async () => {
    const { store, state } = setup()
    const docId = await store.createDocument('Contract')
    await store.appendPage(docId, IMAGE, QUAD)
    await store.appendPage(docId, IMAGE, QUAD)
    const [first, second] = (await store.getDocument(docId))!.pages
    await store.setPageFlat(docId, first.id, FLAT_BYTES, 10, 8)
    await store.setPageEnhanced(docId, first.id, ENH_BYTES, 10, 8)
    await store.setPageFlat(docId, second.id, FLAT_BYTES, 10, 8)
    await store.setPageEnhanced(docId, second.id, ENH_BYTES, 10, 8)
    const before = (await store.getDocument(docId))!
    const doomed = before.pages[1]

    await store.removePage(docId, doomed.id)

    const after = await store.getDocument(docId)
    expect(after?.pages).toHaveLength(1)
    expect(after?.pages[0].id).toBe(first.id)
    expect(state.files.get(doomed.file)).toBeUndefined()
    expect(state.files.get(doomed.flat!.file)).toBeUndefined()
    expect(state.files.get(doomed.enhanced!.file)).toBeUndefined()
    expect(state.files.get(before.pages[0].file)).toBeDefined()
    expect(state.files.get(before.pages[0].flat!.file)).toBeDefined()
    expect(state.files.get(before.pages[0].enhanced!.file)).toBeDefined()
  })

  it('deletes the whole Document when the last page is removed (no empty Documents)', async () => {
    const { store, state } = setup()
    const docId = await store.createDocument('Contract')
    await store.appendPage(docId, IMAGE, QUAD)
    const onlyPage = (await store.getDocument(docId))!.pages[0]

    await store.removePage(docId, onlyPage.id)

    expect(await store.getDocument(docId)).toBeUndefined()
    expect(store.getDocuments()).toHaveLength(0)
    expect(state.files.get(onlyPage.file)).toBeUndefined()
  })
})

// --- Reorder pages -----------------------------------------------------------

describe('movePage', () => {
  it('persists the new order and survives a re-read', async () => {
    const { store } = setup()
    const docId = await store.createDocument('Contract')
    await store.appendPage(docId, { ...IMAGE, bytes: new Uint8Array([1]) })
    await store.appendPage(docId, { ...IMAGE, bytes: new Uint8Array([2]) })
    await store.appendPage(docId, { ...IMAGE, bytes: new Uint8Array([3]) })
    const before = (await store.getDocument(docId))!
    const movedId = before.pages[2].id

    await store.movePage(docId, 2, 0)

    const after = await store.getDocument(docId)
    expect(after?.pages.map((p) => p.id)).toEqual([movedId, before.pages[0].id, before.pages[1].id])
  })

  it('leaves the Document unchanged for an out-of-range move', async () => {
    const { store } = setup()
    const docId = await store.createDocument('Contract')
    await store.appendPage(docId, IMAGE, QUAD)
    await store.appendPage(docId, IMAGE, QUAD)
    const before = (await store.getDocument(docId))!

    await store.movePage(docId, 0, 9)

    const after = await store.getDocument(docId)
    expect(after?.pages.map((p) => p.id)).toEqual(before.pages.map((p) => p.id))
  })
})

// --- Reactive open-Document snapshot (candidate 1's payoff) -------------------
// The behaviour that was untestable before: the snapshot a component reads is the
// value the store itself just wrote. No mirroring, no re-read.

describe('reactive open-Document snapshot', () => {
  it('is undefined until opened, then loads', async () => {
    const { store } = setup()
    const docId = await store.createDocument('C')
    await store.appendPage(docId, IMAGE, QUAD)

    expect(store.getDocumentSnapshot(docId)).toBeUndefined()
    const unsub = store.subscribeDocument(docId, () => {})
    await flush()

    expect(store.getDocumentSnapshot(docId)?.pages).toHaveLength(1)
    unsub()
  })

  it('reflects flat/enhanced/mode/quad mutations into the snapshot without a re-read', async () => {
    const { store } = setup()
    const docId = await store.createDocument('C')
    await store.appendPage(docId, IMAGE, QUAD)
    const unsub = store.subscribeDocument(docId, () => {})
    await flush()
    const pageId = store.getDocumentSnapshot(docId)!.pages[0].id

    await store.setPageFlat(docId, pageId, FLAT_BYTES, 10, 8)
    expect(store.getDocumentSnapshot(docId)!.pages[0].flat).toBeDefined()

    await store.setPageEnhanced(docId, pageId, ENH_BYTES, 10, 8)
    expect(store.getDocumentSnapshot(docId)!.pages[0].enhanced).toBeDefined()

    // A mode change drops only the enhanced; the flat stays.
    await store.updatePageEnhanceMode(docId, pageId, 'bw')
    const afterMode = store.getDocumentSnapshot(docId)!.pages[0]
    expect(afterMode.enhanceMode).toBe('bw')
    expect(afterMode.enhanced).toBeUndefined()
    expect(afterMode.flat).toBeDefined()

    // A quad change drops both the flat and the enhanced.
    await store.updatePageQuad(docId, pageId, QUAD)
    const afterQuad = store.getDocumentSnapshot(docId)!.pages[0]
    expect(afterQuad.flat).toBeUndefined()
    expect(afterQuad.enhanced).toBeUndefined()
    unsub()
  })

  it('reflects remove/move into the snapshot', async () => {
    const { store } = setup()
    const docId = await store.createDocument('C')
    await store.appendPage(docId, { ...IMAGE, bytes: new Uint8Array([1]) })
    await store.appendPage(docId, { ...IMAGE, bytes: new Uint8Array([2]) })
    const unsub = store.subscribeDocument(docId, () => {})
    await flush()
    const [first, second] = store.getDocumentSnapshot(docId)!.pages

    await store.movePage(docId, 1, 0)
    expect(store.getDocumentSnapshot(docId)!.pages.map((p) => p.id)).toEqual([second.id, first.id])

    await store.removePage(docId, second.id)
    expect(store.getDocumentSnapshot(docId)!.pages.map((p) => p.id)).toEqual([first.id])
    unsub()
  })

  it('clears the snapshot when the open Document is deleted', async () => {
    const { store } = setup()
    const docId = await store.createDocument('C')
    await store.appendPage(docId, IMAGE, QUAD)
    const unsub = store.subscribeDocument(docId, () => {})
    await flush()
    expect(store.getDocumentSnapshot(docId)).toBeDefined()

    await store.removeDocument(docId)

    expect(store.getDocumentSnapshot(docId)).toBeUndefined()
    unsub()
  })

  it('notifies listeners when the snapshot changes', async () => {
    const { store } = setup()
    const docId = await store.createDocument('C')
    await store.appendPage(docId, IMAGE, QUAD)
    let calls = 0
    const unsub = store.subscribeDocument(docId, () => {
      calls += 1
    })
    await flush()
    const before = calls

    await store.setPageFlat(docId, store.getDocumentSnapshot(docId)!.pages[0].id, FLAT_BYTES, 10, 8)

    expect(calls).toBeGreaterThan(before)
    unsub()
  })

  it('getDocument returns the cached open Document (same reference as the snapshot)', async () => {
    const { store } = setup()
    const docId = await store.createDocument('C')
    await store.appendPage(docId, IMAGE, QUAD)
    const unsub = store.subscribeDocument(docId, () => {})
    await flush()
    const snap = store.getDocumentSnapshot(docId)

    await expect(store.getDocument(docId)).resolves.toBe(snap)
    unsub()
  })
})

// --- Reactive list snapshot --------------------------------------------------

describe('reactive document list', () => {
  it('reflects create/remove into the list snapshot', async () => {
    const { store } = setup()
    const unsub = store.subscribeDocuments(() => {})
    await flush()
    expect(store.getDocuments()).toHaveLength(0)

    await store.createSinglePageDocument('A', IMAGE, QUAD)
    expect(store.getDocuments()).toHaveLength(1)

    await store.removeDocument(store.getDocuments()[0].id)
    expect(store.getDocuments()).toHaveLength(0)
    unsub()
  })
})
