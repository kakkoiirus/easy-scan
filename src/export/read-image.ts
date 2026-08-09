import { opfsStorage } from '../storage/opfs-storage'
import type { Bytes } from '../types'

/**
 * Read a stored page image (source / flat / enhanced) as bytes, throwing if the
 * file is missing on disk. Shared by export's materialise and assembly-read
 * paths, so the one OPFS read stays in a single impure spot rather than being
 * copied per caller.
 */
export async function readImageBytes(path: string): Promise<Bytes> {
  const blob = await opfsStorage.getPageImage(path)
  if (!blob) throw new Error(`page image not found: ${path}`)
  return new Uint8Array(await blob.arrayBuffer())
}
