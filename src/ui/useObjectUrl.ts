import { useEffect, useState } from 'react'
import { opfsStorage } from '../storage/opfs-storage'

/**
 * Map an OPFS file path to an object URL for display: load the blob off the
 * render path, hand back its URL, and revoke it when the file changes or the
 * caller unmounts. Returns `undefined` until the blob has loaded (or when
 * `file` is absent / missing on disk).
 *
 * Centralises the load → create → revoke lifecycle so every page image (flat,
 * enhanced, thumbnail) is managed one way and none can leak. The previous URL
 * stays valid until the next one is ready (no flicker), and a load that resolves
 * after the caller has moved on is discarded rather than orphaned.
 */
export function useObjectUrl(file: string | undefined): string | undefined {
  const [url, setUrl] = useState<string | undefined>(undefined)

  // Load a fresh object URL whenever the file changes. The callback is fully
  // synchronous after the awaited read resolves, so a single `cancelled` check
  // at its start is enough to drop a late result without creating a URL.
  useEffect(() => {
    if (!file) {
      setUrl(undefined)
      return
    }
    let cancelled = false
    opfsStorage.getPageImage(file).then((blob) => {
      if (cancelled || !blob) return
      setUrl(URL.createObjectURL(blob))
    })
    return () => {
      cancelled = true
    }
  }, [file])

  // Revoke the URL only when it is replaced (or on unmount) — not when the file
  // changes, so the image stays visible while the next one loads.
  useEffect(() => {
    if (!url) return
    return () => URL.revokeObjectURL(url)
  }, [url])

  return url
}
