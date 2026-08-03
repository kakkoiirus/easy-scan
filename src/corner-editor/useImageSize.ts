import { useEffect, useState } from 'react'
import type { CornerImageSize } from './geometry'

/**
 * Read the natural (EXIF-oriented) pixel dimensions of an image URL. Browsers
 * apply `image-orientation: from-image` by default, so these match the
 * coordinates the worker's `detect` returns (which also decodes with
 * `imageOrientation: 'from-image'`) — keeping the Quad and the photo aligned.
 *
 * Returns null until the image has decoded (or when `url` is absent).
 */
export function useImageSize(url?: string): CornerImageSize | null {
  const [size, setSize] = useState<CornerImageSize | null>(null)

  useEffect(() => {
    if (!url) {
      setSize(null)
      return
    }
    let cancelled = false
    const img = new Image()
    img.onload = () => {
      if (cancelled) return
      setSize({ width: img.naturalWidth, height: img.naturalHeight })
    }
    img.src = url
    return () => {
      cancelled = true
    }
  }, [url])

  return size
}
