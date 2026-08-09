import type { Bytes } from '../types'

/**
 * Hand the assembled PDF bytes to the user — the isolated delivery seam, the
 * only place export touches the outside world (navigator + DOM).
 *
 * Uses Web Share with a file where the browser advertises support (primarily
 * mobile, where a tap sends the PDF to another app), and falls back to a plain
 * download via an object URL everywhere else. Feature-detected, so a desktop or
 * unsupported browser always gets the download.
 *
 * Impure by design; verified manually (secure context + a real share target),
 * the same boundary as the camera controller — not unit-tested.
 */
export async function deliverPdf(bytes: Bytes, filename: string): Promise<void> {
  const file = new File([bytes], filename, { type: 'application/pdf' })

  if (canShareFiles(file)) {
    try {
      await navigator.share({ files: [file] })
      return
    } catch (err) {
      // The user dismissed the sheet (AbortError) — leave them be. Any other
      // failure falls through to a download so the PDF is never lost.
      if (err instanceof DOMException && err.name === 'AbortError') return
    }
  }

  downloadFile(file, filename)
}

/** True only when the browser can actually share files (not just `share`). */
function canShareFiles(file: File): boolean {
  return (
    typeof navigator.share === 'function' &&
    typeof navigator.canShare === 'function' &&
    navigator.canShare({ files: [file] })
  )
}

function downloadFile(file: File, filename: string): void {
  const url = URL.createObjectURL(file)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.rel = 'noopener'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}
