import type { Bytes, Document, DocumentSummary } from '../types'
import type { Storage } from './storage-port'

/**
 * OPFS-only storage (ADR-0003). Metadata lives in a single `library.json`;
 * source JPEGs live as files under per-document folders. No database.
 *
 * Hardening TODO (per ADR-0003): `writeLibrary` should be made atomic
 * (write `library.json.tmp`, then move over `library.json`) and we should
 * reconcile orphaned files on startup. Acceptable for M0 single-tab use.
 */

const LIBRARY_FILE = 'library.json'
const DOCS_DIR = 'documents'

type LibraryFile = { readonly documents?: readonly Document[] }

function root(): Promise<FileSystemDirectoryHandle> {
  return navigator.storage.getDirectory()
}

async function readLibrary(): Promise<readonly Document[]> {
  try {
    const handle = await (await root()).getFileHandle(LIBRARY_FILE)
    const file = await handle.getFile()
    const text = await file.text()
    const parsed = JSON.parse(text) as LibraryFile
    return parsed.documents ?? []
  } catch {
    // Missing or unreadable library -> treat as empty (first run / corruption).
    return []
  }
}

async function writeLibrary(documents: readonly Document[]): Promise<void> {
  const dir = await root()
  const handle = await dir.getFileHandle(LIBRARY_FILE, { create: true })
  const writable = await handle.createWritable()
  await writable.write(JSON.stringify({ documents } satisfies LibraryFile))
  await writable.close()
}

function toSummary(doc: Document): DocumentSummary {
  return { id: doc.id, title: doc.title, createdAt: doc.createdAt, pageCount: doc.pages.length }
}

/** Write `bytes` to `documents/<docId>/<name>` and return that OPFS path. */
async function writePageFile(docId: string, name: string, bytes: Bytes): Promise<string> {
  const docsDir = await (await root()).getDirectoryHandle(DOCS_DIR, { create: true })
  const docDir = await docsDir.getDirectoryHandle(docId, { create: true })
  const fileHandle = await docDir.getFileHandle(name, { create: true })
  const writable = await fileHandle.createWritable()
  await writable.write(bytes)
  await writable.close()
  return `${DOCS_DIR}/${docId}/${name}`
}

/** Walk a `documents/<docId>/<name>` path to its parent directory and return that
 *  directory plus the leaf file name. Throws if any segment is missing — callers
 *  catch and treat a missing file as absent. Shared by the by-path read/delete. */
async function parentDirOf(
  path: string,
): Promise<{ dir: FileSystemDirectoryHandle; name: string }> {
  const parts = path.split('/')
  let dir = await root()
  for (let i = 0; i < parts.length - 1; i += 1) {
    dir = await dir.getDirectoryHandle(parts[i] as string)
  }
  return { dir, name: parts[parts.length - 1] as string }
}

export const opfsStorage: Storage = {
  async listDocuments(): Promise<readonly DocumentSummary[]> {
    const docs = await readLibrary()
    return [...docs].sort((a, b) => b.createdAt - a.createdAt).map(toSummary)
  },

  async getDocument(id: string): Promise<Document | undefined> {
    return (await readLibrary()).find((d) => d.id === id)
  },

  async putDocument(doc: Document): Promise<void> {
    const docs = await readLibrary()
    const next = [...docs.filter((d) => d.id !== doc.id), doc].sort(
      (a, b) => b.createdAt - a.createdAt,
    )
    await writeLibrary(next)
  },

  async deleteDocument(id: string): Promise<void> {
    const docs = await readLibrary()
    await writeLibrary(docs.filter((d) => d.id !== id))
    // Best-effort removal of the document's image folder.
    try {
      const docsDir = await (await root()).getDirectoryHandle(DOCS_DIR)
      await docsDir.removeEntry(id, { recursive: true })
    } catch {
      // Folder may not exist; nothing to remove.
    }
  },

  async putPageImage(docId: string, pageId: string, bytes: Bytes): Promise<string> {
    return writePageFile(docId, `${pageId}.jpg`, bytes)
  },

  async putPageFlat(docId: string, pageId: string, bytes: Bytes): Promise<string> {
    return writePageFile(docId, `${pageId}.flat.jpg`, bytes)
  },

  async putPageEnhanced(docId: string, pageId: string, bytes: Bytes): Promise<string> {
    return writePageFile(docId, `${pageId}.enh.jpg`, bytes)
  },

  async getPageImage(path: string): Promise<Blob | undefined> {
    try {
      const { dir, name } = await parentDirOf(path)
      return await (await dir.getFileHandle(name)).getFile()
    } catch {
      return undefined
    }
  },

  async deletePageFile(path: string): Promise<void> {
    // Best-effort: a page's flat/enhanced may never have materialised, so the
    // file may not exist — mirror `deleteDocument`'s folder-removal and swallow.
    try {
      const { dir, name } = await parentDirOf(path)
      await dir.removeEntry(name)
    } catch {
      // File missing — nothing to reclaim.
    }
  },
}
